import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatarDataHora, paraCampo, paraInstante, sugestaoDeInicio } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Livre = { veiculo_id: string; placa: string; modelo: string }
type Horario = { inicio: string; fim: string }
type Pendente = { id: string; nome: string; versao: number; config: Record<string, number | boolean> }
type Mensagem = { texto: string; erro: boolean; link?: boolean }

function regras(c: Pendente['config']): string[] {
  return [
    `Reservar com pelo menos ${c.antecedencia_min_horas} h e no máximo ${c.antecedencia_max_dias} dias de antecedência.`,
    `Cada reserva dura no máximo ${c.duracao_max_horas} h; o limite por semana é de ${c.limite_semanal_horas} h.`,
    `Retire o veículo em até ${c.tolerancia_noshow_min} min do horário, ou a reserva é perdida.`,
    `Devolva no horário: atraso acima de ${c.tolerancia_atraso_min} min é comunicado ao gestor.`,
    `Cancele com pelo menos ${c.cancelamento_min_horas} h de antecedência.`,
    ...(c.aprovar_pernoite ? ['Reservas com pernoite precisam de aprovação.'] : []),
    ...(c.aprovar_fim_de_semana ? ['Reservas em fim de semana precisam de aprovação.'] : []),
  ]
}

export default function Reservar() {
  const { session } = useAuth()
  const { empresaId } = useEmpresa()
  const categorias = useOpcoes('categorias', 'id', 'nome', empresaId)
  const [pendentes, setPendentes] = useState<Pendente[] | null>(null)
  const [inicio, setInicio] = useState(() => sugestaoDeInicio())
  const [fim, setFim] = useState(() => sugestaoDeInicio(new Date(), 4))
  const [categoriaId, setCategoriaId] = useState('')
  const [finalidade, setFinalidade] = useState('')
  const [destino, setDestino] = useState('')
  const [livres, setLivres] = useState<Livre[] | null>(null)
  const [alternativas, setAlternativas] = useState<Horario[]>([])
  const [mensagem, setMensagem] = useState<Mensagem | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregarPendentes = useCallback(async () => {
    if (!empresaId) return
    const { data } = await supabase.rpc('politicas_pendentes', { p_empresa: empresaId })
    setPendentes((data as Pendente[]) ?? [])
  }, [empresaId])

  useEffect(() => { void carregarPendentes() }, [carregarPendentes])

  async function aceitar() {
    if (!pendentes || !session) return
    const { error } = await supabase.from('aceites_de_politica').insert(
      pendentes.map((p) => ({ empresa_id: empresaId, politica_id: p.id, user_id: session.user.id })),
    )
    if (error) setMensagem({ texto: 'Não foi possível registrar o aceite. Tente novamente.', erro: true })
    await carregarPendentes()
  }

  async function sugerir(ini: string, f: string, veiculo?: string) {
    const { data } = await supabase.rpc('sugerir_horarios', {
      p_inicio: paraInstante(ini), p_fim: paraInstante(f),
      p_categoria: categoriaId || null, p_veiculo: veiculo ?? null,
    })
    setAlternativas((data as Horario[]) ?? [])
  }

  async function buscar(ini = inicio, f = fim) {
    setMensagem(null)
    setAlternativas([])
    if (paraInstante(f) <= paraInstante(ini)) {
      setLivres(null)
      return setMensagem({ texto: 'A devolução precisa ser depois da retirada.', erro: true })
    }
    setOcupado(true)
    const { data, error } = await supabase.rpc('disponibilidade', {
      p_inicio: paraInstante(ini), p_fim: paraInstante(f), p_categoria: categoriaId || null,
    })
    setOcupado(false)
    if (error) return setMensagem({ texto: mensagemDeErro(error), erro: true })
    const lista = (data as Livre[]) ?? []
    setLivres(lista)
    if (lista.length === 0) await sugerir(ini, f)
  }

  async function reservar(veiculoId: string | null) {
    setMensagem(null)
    setOcupado(true)
    const comum = {
      p_inicio: paraInstante(inicio), p_fim: paraInstante(fim),
      p_finalidade: finalidade.trim() || null, p_destino: destino.trim() || null,
    }
    const { data, error } = veiculoId
      ? await supabase.rpc('criar_reserva', { p_veiculo: veiculoId, ...comum })
      : await supabase.rpc('criar_reserva_por_categoria', { p_categoria: categoriaId, ...comum })
    setOcupado(false)
    if (error) {
      setMensagem({ texto: mensagemDeErro(error), erro: true })
      if (/conflito_agenda|sem_veiculo_disponivel/.test(error.message)) {
        setLivres(null)
        await sugerir(inicio, fim, veiculoId ?? undefined)
      }
      if (error.message.includes('politica_nao_aceita')) await carregarPendentes()
      return
    }
    const status = (data as { status: string }).status
    setMensagem({
      texto: status === 'solicitada'
        ? 'Reserva enviada para aprovação. Acompanhe a decisão em Minhas reservas.'
        : 'Reserva confirmada.',
      erro: false, link: true,
    })
    setLivres(null)
  }

  function usarHorario(h: Horario) {
    const ini = paraCampo(h.inicio)
    const f = paraCampo(h.fim)
    setInicio(ini)
    setFim(f)
    void buscar(ini, f)
  }

  if (pendentes && pendentes.length > 0) {
    return (
      <main>
        <h1>Reservar veículo</h1>
        <section className="cartao" aria-label="Política de uso">
          <h2>Antes de reservar, leia e aceite a política de uso</h2>
          {pendentes.map((p) => (
            <div key={p.id}>
              <p><strong>{p.nome}</strong> · versão {p.versao}</p>
              <ul>{regras(p.config).map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          ))}
          {mensagem && <p role="alert" className="erro">{mensagem.texto}</p>}
          <button type="button" onClick={aceitar}>Li e aceito</button>
        </section>
      </main>
    )
  }

  const nomeCategoria = categorias.find((c) => c.valor === categoriaId)?.rotulo

  return (
    <main>
      <h1>Reservar veículo</h1>
      <section className="cartao">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void buscar() }} className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          <label>Retirada
            <input type="datetime-local" required value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </label>
          <label>Devolução
            <input type="datetime-local" required value={fim} onChange={(e) => setFim(e.target.value)} />
          </label>
          <label>Categoria
            <select value={categoriaId} onChange={(e) => { setCategoriaId(e.target.value); setLivres(null) }}>
              <option value="">Qualquer</option>
              {categorias.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
          </label>
          <label>Finalidade (opcional)
            <input value={finalidade} onChange={(e) => setFinalidade(e.target.value)} />
          </label>
          <label>Destino (opcional)
            <input value={destino} onChange={(e) => setDestino(e.target.value)} />
          </label>
          <div className="acoes"><button type="submit" disabled={ocupado}>Ver disponibilidade</button></div>
        </form>
        <p style={{ fontSize: '.85rem', marginBottom: 0 }}>Horários em horário de Brasília.</p>
      </section>

      {mensagem && (
        <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>
          {mensagem.texto} {mensagem.link && <Link to="/reservas">Ver minhas reservas</Link>}
        </p>
      )}

      {livres && livres.length > 0 && (
        <section className="cartao" aria-label="Veículos livres">
          <h2>Livres nesse período</h2>
          {categoriaId && (
            <p><button type="button" disabled={ocupado} onClick={() => reservar(null)}>Reservar um {nomeCategoria} (o sistema escolhe)</button></p>
          )}
          <ul>
            {livres.map((l) => (
              <li key={l.veiculo_id} className="acoes" style={{ marginBottom: 8 }}>
                <span>{l.placa} · {l.modelo}</span>
                <button type="button" className="secundario" disabled={ocupado} onClick={() => reservar(l.veiculo_id)}>Reservar este</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {livres && livres.length === 0 && <p role="status">Nenhum veículo livre nesse período.</p>}

      {alternativas.length > 0 && (
        <section className="cartao" aria-label="Horários alternativos">
          <h2>Próximos horários livres</h2>
          <div className="acoes">
            {alternativas.map((h) => (
              <button key={h.inicio} type="button" className="secundario" onClick={() => usarHorario(h)}>
                {formatarDataHora(h.inicio)}
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
