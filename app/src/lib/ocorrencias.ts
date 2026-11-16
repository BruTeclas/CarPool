import { prepararFoto, subirFoto } from './fotos'
import type { FotoDaVistoria } from './fotos'
import { enfileirar, guardar, ler } from './local'
import { semSinal } from './offline'
import { supabase } from './supabase'

export const TIPOS_OCORRENCIA = [
  { id: 'pane_mecanica', rotulo: 'Pane mecânica', ajuda: 'O carro parou ou não liga.' },
  { id: 'pneu_bateria', rotulo: 'Pneu ou bateria', ajuda: 'Pneu furado, bateria descarregada.' },
  { id: 'acidente_sem_vitima', rotulo: 'Acidente sem vítima', ajuda: 'Batida ou dano, ninguém se feriu.' },
  { id: 'acidente_com_vitima', rotulo: 'Acidente com vítima', ajuda: 'Alguém se feriu.' },
  { id: 'roubo_furto', rotulo: 'Roubo ou furto', ajuda: 'O carro foi levado ou arrombado.' },
] as const
export type TipoOcorrencia = (typeof TIPOS_OCORRENCIA)[number]['id']
export const rotuloOcorrencia = (t: string) => TIPOS_OCORRENCIA.find((x) => x.id === t)?.rotulo ?? t

export type Assistencia = { seguradora: string | null; apolice: string | null; telefone_assistencia: string; observacao: string | null }
type ContatoGuardado = Assistencia & { veiculo_id: string | null; placa: string | null }

/** Guarda no aparelho os telefones de assistência, para a tela de ocorrência funcionar sem sinal. */
export async function baixarAssistencia(empresaId: string): Promise<void> {
  const { data, error } = await supabase.from('contatos_assistencia')
    .select('veiculo_id, seguradora, apolice, telefone_assistencia, observacao, veiculos(placa)')
    .eq('empresa_id', empresaId)
  if (error || !data) return
  const lista: ContatoGuardado[] = (data as unknown as (Assistencia & { veiculo_id: string | null; veiculos: { placa: string } | null })[])
    .map(({ veiculos, ...c }) => ({ ...c, placa: veiculos?.placa ?? null }))
  await guardar('assistencia', lista).catch(() => undefined)
}

/** Contato do carro (pela placa) ou o padrão da empresa, a partir do que está guardado no aparelho. */
export async function assistenciaDoCarro(placa: string | null | undefined): Promise<Assistencia | null> {
  const lista = (await ler<ContatoGuardado[]>('assistencia').catch(() => undefined)) ?? []
  return lista.find((c) => placa && c.placa === placa) ?? lista.find((c) => c.veiculo_id === null) ?? null
}

export type NovaOcorrencia = {
  reserva: string; empresa: string; tipo: TipoOcorrencia; descricao: string; endereco: string
  latitude: number | null; longitude: number | null; precisao: number | null; arquivos: File[]
}
export type OcorrenciaPendente = {
  tipo: 'ocorrencia'; reserva: string; empresa: string; ocorrencia: TipoOcorrencia; descricao: string; endereco: string
  latitude: number | null; longitude: number | null; precisao: number | null; fotos: FotoDaVistoria[]; em: string
}

export async function enviarOcorrencia(p: OcorrenciaPendente): Promise<{ error: { message: string } | null; assistencia?: Assistencia | null }> {
  const fotos = []
  for (const f of p.fotos) fotos.push('caminho' in f ? f : await subirFoto(p.empresa, p.reserva, 'ocorrencia', f))
  const { data, error } = await supabase.rpc('registrar_ocorrencia', {
    p_reserva: p.reserva, p_tipo: p.ocorrencia, p_descricao: p.descricao || null,
    p_latitude: p.latitude, p_longitude: p.longitude, p_precisao_m: p.precisao, p_endereco: p.endereco || null,
    p_fotos: fotos, p_registrada_em: p.em,
  })
  return { error, assistencia: (data as { assistencia?: Assistencia | null } | null)?.assistencia ?? null }
}

/** Registra a ocorrência; sem sinal, guarda no aparelho e envia quando a conexão voltar. */
export async function registrarOcorrencia(n: NovaOcorrencia): Promise<{ resultado: 'enviada' | 'guardada' | 'recusada'; erro?: { message: string }; assistencia?: Assistencia | null }> {
  const fotos: FotoDaVistoria[] = []
  for (const [i, a] of n.arquivos.entries()) fotos.push(await prepararFoto(`foto${i + 1}`, a))
  const pendente: OcorrenciaPendente = {
    tipo: 'ocorrencia', reserva: n.reserva, empresa: n.empresa, ocorrencia: n.tipo, descricao: n.descricao.trim(),
    endereco: n.endereco.trim(), latitude: n.latitude, longitude: n.longitude, precisao: n.precisao, fotos, em: new Date().toISOString(),
  }
  if (!navigator.onLine) { await enfileirar(pendente); return { resultado: 'guardada' } }
  try {
    const { error, assistencia } = await enviarOcorrencia(pendente)
    if (!error) return { resultado: 'enviada', assistencia }
    if (semSinal(error)) { await enfileirar(pendente); return { resultado: 'guardada' } }
    return { resultado: 'recusada', erro: error }
  } catch (e) {
    if (semSinal(e as Error)) { await enfileirar(pendente); return { resultado: 'guardada' } }
    throw e
  }
}
