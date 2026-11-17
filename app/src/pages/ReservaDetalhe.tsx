import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Veiculo } from '../components/Placa'
import { Situacao } from '../components/Situacao'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { rotuloOcorrencia } from '../lib/ocorrencias'
import { reservasLocais } from '../lib/offline'
import { useOpcoes } from '../lib/opcoes'
import { podeCancelar, rotuloStatus } from '../lib/status'
import { Voltar } from '../components/Voltar'
import { supabase } from '../lib/supabase'

type Reserva = {
  id: string; inicio: string; fim: string; status: string; finalidade: string | null; destino: string | null
  motorista_id: string; solicitante_id: string; codigo_retirada: string; veiculos: { placa: string; modelo: string } | null
}
type Realocacao = { id: string; status: string; motivo: string; sugerido: { placa: string; modelo: string } | null }
type Incidente = { id: string; tipo: string; registrada_em: string; status: string; local_veiculo: string | null }
type Evento = { id: number; para_status: string; ator_id: string | null; em: string; detalhe: Record<string, unknown> }

export default function ReservaDetalhe() {
  const { id } = useParams()
  const { session } = useAuth()
  const { empresaId, podeGerir, podeOperar } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [reserva, setReserva] = useState<Reserva | null | undefined>(undefined)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [troca, setTroca] = useState<Realocacao | null>(null)
  const [incidentes, setIncidentes] = useState<Incidente[]>([])
  const [respondendo, setRespondendo] = useState(false)

  const carregar = useCallback(async () => {
    const doAparelho = async () => {
      const l = (await reservasLocais()).find((x) => x.id === id)
      const uid = session?.user.id ?? ''
      setReserva(l ? { id: l.id, inicio: l.inicio, fim: l.fim, status: l.status, finalidade: null, destino: null, motorista_id: uid, solicitante_id: uid, codigo_retirada: l.codigo_retirada, veiculos: { placa: l.placa, modelo: l.modelo } } : null)
    }
    if (!navigator.onLine) return doAparelho()
    const [r, e, t, o] = await Promise.all([
      supabase.from('reservas')
        .select('id, inicio, fim, status, finalidade, destino, motorista_id, solicitante_id, codigo_retirada, veiculos(placa, modelo)')
        .eq('id', id ?? '').maybeSingle<Reserva>(),
      supabase.from('eventos_da_reserva').select('id, para_status, ator_id, em, detalhe')
        .eq('reserva_id', id ?? '').order('em').returns<Evento[]>(),
      supabase.from('realocacoes').select('id, status, motivo, sugerido:veiculos!realocacoes_veiculo_sugerido_id_fkey(placa, modelo)')
        .eq('reserva_id', id ?? '').in('status', ['oferecida', 'sem_alternativa']).order('criada_em', { ascending: false }).limit(1)
        .returns<Realocacao[]>(),
      supabase.from('incidentes').select('id, tipo, registrada_em, status, local_veiculo').eq('reserva_id', id ?? '').order('registrada_em')
        .returns<Incidente[]>(),
    ])
    if (r.error) return doAparelho()
    setReserva(r.data ?? null)
    setEventos(e.data ?? [])
    setTroca(t.data?.[0] ?? null)
    setIncidentes(o.data ?? [])
  }, [id, session?.user.id])

  async function responderTroca(aceitar: boolean) {
    if (!troca) return
    setErro(null)
    setRespondendo(true)
    const { error } = await supabase.rpc('responder_realocacao', { p_realocacao: troca.id, p_aceitar: aceitar })
    if (error) setErro(mensagemDeErro(error))
    setRespondendo(false)
    await carregar()
  }

  useEffect(() => { void carregar() }, [carregar])

  async function cancelar() {
    if (!window.confirm('Cancelar esta reserva?')) return
    setErro(null)
    const { error } = await supabase.rpc('transicionar_reserva', { p_reserva: id, p_para: 'cancelada' })
    if (error) setErro(mensagemDeErro(error))
    await carregar()
  }

  const nome = (uid: string | null) => (uid ? pessoas.find((p) => p.valor === uid)?.rotulo ?? 'Usuário' : 'Sistema')

  if (reserva === undefined) return <main><p>Carregando…</p></main>
  if (reserva === null) return <main><p role="alert" className="erro">Reserva não encontrada.</p><Link to="/reservas">Voltar</Link></main>

  const uid = session?.user.id
  const dono = reserva.motorista_id === uid || reserva.solicitante_id === uid

  return (
    <main>
      <Voltar para="/reservas">Minhas reservas</Voltar>
      <h1><Veiculo placa={reserva.veiculos?.placa} modelo={reserva.veiculos?.modelo} /></h1>
      <section className="cartao" aria-label="Dados da reserva">
        <p><Situacao status={reserva.status} /></p>
        <p>Retirada: {formatarDataHora(reserva.inicio)}<br />Devolução: {formatarDataHora(reserva.fim)}</p>
        <p>Motorista: {nome(reserva.motorista_id)}</p>
        {reserva.finalidade && <p>Finalidade: {reserva.finalidade}</p>}
        {reserva.destino && <p>Destino: {reserva.destino}</p>}
        {troca?.status === 'oferecida' && ['solicitada', 'aprovada', 'liberada'].includes(reserva.status) && (dono || podeOperar) && (
          <div className="aviso destaque" role="region" aria-label="Troca de veículo">
            <p style={{ marginTop: 0 }}><strong>O carro desta reserva pode não estar disponível</strong> ({troca.motivo === 'atraso' ? 'a devolução anterior está atrasada' : 'o carro teve uma pane ou acidente'}).</p>
            <p>Oferecemos no mesmo horário: <Veiculo placa={troca.sugerido?.placa} modelo={troca.sugerido?.modelo} /></p>
            <div className="acoes">
              <button type="button" disabled={respondendo} onClick={() => responderTroca(true)}>Aceitar a troca</button>
              <button type="button" className="secundario" disabled={respondendo} onClick={() => responderTroca(false)}>Manter o carro original</button>
            </div>
          </div>
        )}
        {troca?.status === 'sem_alternativa' && ['solicitada', 'aprovada', 'liberada'].includes(reserva.status) && (
          <p className="aviso destaque">O carro desta reserva pode não estar disponível e não há outro livre no horário. O gestor da frota foi avisado.</p>
        )}
        {reserva.status === 'ocorrencia' && (
          <div className="aviso destaque">
            <p style={{ marginTop: 0 }}><strong>{incidentes.map((i) => rotuloOcorrencia(i.tipo)).join(', ') || 'Ocorrência'} registrada.</strong></p>
            <p style={{ marginBottom: 0 }}>O gestor da frota foi avisado e vai encerrar a reserva. {dono && <Link to={`/reservas/${reserva.id}/ocorrencia`}>Ver a assistência ou registrar outra informação</Link>}</p>
          </div>
        )}
        {reserva.status === 'aprovada' && dono && (
          <div className="aviso">
            <p style={{ marginTop: 0 }}>Para retirar: leia o QR da chave com a câmera do celular, ou informe este código na portaria.</p>
            <p className="codigo-grande" style={{ margin: 0 }} aria-label="Código de retirada">{reserva.codigo_retirada}</p>
          </div>
        )}
        {reserva.status === 'liberada' && (dono || podeOperar) && (
          <p><Link className="botao" to={`/reservas/${reserva.id}/vistoria/saida`}>Fazer vistoria de saída</Link></p>
        )}
        {(reserva.status === 'em_uso' || reserva.status === 'atrasada') && (dono || podeOperar) && (
          <p><Link className="botao" to={`/reservas/${reserva.id}/vistoria/chegada`}>Devolver veículo (vistoria de chegada)</Link></p>
        )}
        {(reserva.status === 'em_uso' || reserva.status === 'atrasada') && (dono || podeOperar) && (
          <p className="sos-fixo"><Link className="botao sos" to={`/reservas/${reserva.id}/ocorrencia`}>Pane ou acidente</Link></p>
        )}
        {reserva.status === 'devolvida' && <p>Devolução registrada. Aguardando a conferência do gestor.</p>}
        {erro && <p role="alert" className="erro">{erro}</p>}
        {podeCancelar(reserva.status) && (dono || podeGerir) && (
          <button type="button" className="perigo" onClick={cancelar}>Cancelar reserva</button>
        )}
      </section>
      <section className="cartao" aria-label="Histórico">
        <h2>Histórico</h2>
        <ol>
          {eventos.map((e) => (
            <li key={e.id} style={{ marginBottom: 8 }}>
              <strong>{e.detalhe.realocada_para !== undefined ? 'Troca de veículo' : rotuloStatus(e.para_status)}</strong>, {formatarDataHora(e.em)}, por {nome(e.ator_id)}
              {typeof e.detalhe.justificativa === 'string' && e.detalhe.justificativa && <><br />Justificativa: {e.detalhe.justificativa}</>}
              {e.detalhe.motivo === 'falha_critica_no_checklist' && <><br />Item de segurança reprovado na vistoria; sem penalidade.</>}
              {e.detalhe.cancelamento_tardio === true && <><br />Cancelamento fora do prazo da política.</>}
              {e.detalhe.automatico === true && <><br />{e.detalhe.motivo === 'expirou_sem_aprovacao' ? 'Expirou sem aprovação.' : 'Registrado automaticamente pelo sistema.'}</>}
              {typeof e.detalhe.tipo === 'string' && e.para_status === 'ocorrencia' && <><br />{rotuloOcorrencia(e.detalhe.tipo)}</>}
              {e.detalhe.realocada_para !== undefined && <><br />Veículo trocado ({e.detalhe.motivo === 'atraso' ? 'devolução anterior atrasada' : 'ocorrência com o carro original'}).</>}
              {e.detalhe.encerramento_especial === true && <><br />Encerramento especial. Local do carro: {String(e.detalhe.local_veiculo ?? '')}</>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
