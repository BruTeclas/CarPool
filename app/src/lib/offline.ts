import { sha256Hex, subirFoto } from './fotos'
import type { FotoDaVistoria } from './fotos'
import { enfileirar, guardar, ler, lerFila, removerDaFila } from './local'
import { supabase } from './supabase'

export type ItemChecklist = { item: string; critico: boolean; ordem: number }
export type ReservaLocal = {
  id: string; empresa_id: string; status: string; inicio: string; fim: string; codigo_retirada: string
  placa: string; modelo: string; odometro_km: number; chave_sha256: string; tolerancia_noshow_min: number
  checklist: ItemChecklist[]
}
export type Leitura = {
  resultado: string; reserva_id?: string; placa?: string; modelo?: string; inicio?: string; livre_agora?: boolean; offline?: boolean
}
type Pendente =
  | { tipo: 'leitura'; codigo: string; em: string }
  | {
    tipo: 'vistoria'; reserva: string; empresa: string; vistoria: 'saida' | 'chegada'; odometro: number; combustivel: number
    itens: { item: string; ok: boolean; observacao: string }[]; fotos: FotoDaVistoria[]; observacoes: string; avarias: string[]
  }
export type VistoriaPendente = Extract<Pendente, { tipo: 'vistoria' }>

/** Erro de rede (sem sinal), em oposição a uma recusa do servidor. */
export function semSinal(erro?: { message?: string } | null): boolean {
  if (!navigator.onLine) return true
  return !!erro && /failed to fetch|networkerror|load failed|network request failed/i.test(erro.message ?? '')
}

/** Baixa as reservas ativas do motorista para o aparelho. Chamar sempre que houver sinal. */
export async function baixarPacote(): Promise<void> {
  if (!navigator.onLine) return
  const { data, error } = await supabase.rpc('minhas_reservas_offline')
  if (!error && Array.isArray(data)) await guardar('reservas', data)
}

export async function reservasLocais(): Promise<ReservaLocal[]> {
  return (await ler<ReservaLocal[]>('reservas').catch(() => undefined)) ?? []
}

async function mudarLocal(id: string, status: string) {
  const lista = await reservasLocais()
  await guardar('reservas', lista.map((r) => (r.id === id ? { ...r, status } : r)))
}

/** Confere a chave contra as reservas guardadas no aparelho e deixa a leitura na fila. */
export async function lerChaveSemSinal(codigo: string, agora = new Date()): Promise<Leitura> {
  const [lista, resumo] = await Promise.all([reservasLocais(), sha256Hex(codigo)])
  const t = agora.getTime()
  const minha = lista.find((r) => r.chave_sha256 === resumo)
  if (minha) {
    const base = { reserva_id: minha.id, placa: minha.placa, modelo: minha.modelo, offline: true }
    if (minha.status === 'em_uso' || minha.status === 'atrasada') return { ...base, resultado: 'devolucao' }
    if (minha.status === 'liberada') return { ...base, resultado: 'chave_certa' }
    const inicio = new Date(minha.inicio).getTime()
    if (t < inicio - 15 * 60000) return { ...base, resultado: 'antes_da_janela', inicio: minha.inicio }
    if (t > inicio + minha.tolerancia_noshow_min * 60000) return { ...base, resultado: 'fora_da_janela' }
    await enfileirar({ tipo: 'leitura', codigo, em: agora.toISOString() } satisfies Pendente)
    await mudarLocal(minha.id, 'liberada')
    return { ...base, resultado: 'chave_certa' }
  }
  const outra = lista.find((r) => ['aprovada', 'liberada'].includes(r.status)
    && t >= new Date(r.inicio).getTime() - 3600000 && t <= new Date(r.fim).getTime())
  if (outra) return { resultado: 'chave_errada', reserva_id: outra.id, placa: outra.placa, modelo: outra.modelo, offline: true }
  return { resultado: 'sem_sinal', offline: true }
}

/** Guarda a vistoria no aparelho para enviar depois. Devolve o resultado previsto. */
export async function guardarVistoria(v: Omit<VistoriaPendente, 'tipo'>, checklist: ItemChecklist[]): Promise<{ resultado: string; itens?: string; offline: true }> {
  await enfileirar({ tipo: 'vistoria', ...v } satisfies Pendente)
  const reprovados = v.itens.filter((i) => !i.ok && checklist.find((c) => c.item === i.item)?.critico).map((i) => i.item)
  if (v.vistoria === 'saida') {
    if (reprovados.length) { await mudarLocal(v.reserva, 'cancelada'); return { resultado: 'veiculo_bloqueado', itens: reprovados.join(', '), offline: true } }
    await mudarLocal(v.reserva, 'em_uso')
    return { resultado: 'em_uso', offline: true }
  }
  await mudarLocal(v.reserva, 'devolvida')
  return { resultado: 'guardada', offline: true }
}

export async function pendentes(): Promise<number> {
  return (await lerFila<Pendente>().catch(() => [])).length
}

let enviando = false
/** Envia a fila na ordem em que foi criada. Para no primeiro erro de rede; recusas do servidor viram problema. */
export async function sincronizar(): Promise<{ enviados: number; problemas: string[] }> {
  const resultado = { enviados: 0, problemas: [] as string[] }
  if (enviando || !navigator.onLine) return resultado
  enviando = true
  try {
    for (const { id, item } of await lerFila<Pendente>()) {
      if (item.tipo === 'leitura') {
        const { data, error } = await supabase.rpc('ler_chave', { p_codigo: item.codigo, p_lido_em: item.em })
        if (error && semSinal(error)) break
        const r = (data as Leitura | null)?.resultado
        if (error || (r !== 'chave_certa' && r !== 'devolucao')) resultado.problemas.push('Uma retirada feita sem sinal não foi aceita pelo sistema. Fale com o gestor da frota.')
      } else {
        try {
          const fotos = []
          for (const f of item.fotos) fotos.push('caminho' in f ? f : await subirFoto(item.empresa, item.reserva, item.vistoria, f))
          const { error } = await supabase.rpc('registrar_vistoria', {
            p_reserva: item.reserva, p_tipo: item.vistoria, p_odometro: item.odometro, p_combustivel: item.combustivel,
            p_itens: item.itens, p_fotos: fotos, p_observacoes: item.observacoes, p_avarias: item.avarias,
          })
          if (error && semSinal(error)) break
          if (error) resultado.problemas.push(`A vistoria de ${item.vistoria === 'saida' ? 'saída' : 'chegada'} feita sem sinal não foi aceita (${error.message}). Fale com o gestor da frota.`)
        } catch (e) {
          if (semSinal(e as Error)) break
          resultado.problemas.push('Não foi possível enviar as fotos de uma vistoria feita sem sinal. Fale com o gestor da frota.')
        }
      }
      await removerDaFila(id)
      resultado.enviados++
    }
    await baixarPacote()
  } finally {
    enviando = false
  }
  return resultado
}
