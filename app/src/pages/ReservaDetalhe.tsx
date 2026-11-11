import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { podeCancelar, rotuloStatus } from '../lib/status'
import { supabase } from '../lib/supabase'

type Reserva = {
  id: string; inicio: string; fim: string; status: string; finalidade: string | null; destino: string | null
  motorista_id: string; solicitante_id: string; veiculos: { placa: string; modelo: string } | null
}
type Evento = { id: number; para_status: string; ator_id: string | null; em: string; detalhe: Record<string, unknown> }

export default function ReservaDetalhe() {
  const { id } = useParams()
  const { session } = useAuth()
  const { empresaId, podeGerir } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [reserva, setReserva] = useState<Reserva | null | undefined>(undefined)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [r, e] = await Promise.all([
      supabase.from('reservas')
        .select('id, inicio, fim, status, finalidade, destino, motorista_id, solicitante_id, veiculos(placa, modelo)')
        .eq('id', id ?? '').maybeSingle<Reserva>(),
      supabase.from('eventos_da_reserva').select('id, para_status, ator_id, em, detalhe')
        .eq('reserva_id', id ?? '').order('em').returns<Evento[]>(),
    ])
    setReserva(r.data ?? null)
    setEventos(e.data ?? [])
  }, [id])

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
      <p><Link to="/reservas">← Minhas reservas</Link></p>
      <h1>{reserva.veiculos?.placa} · {reserva.veiculos?.modelo}</h1>
      <section className="cartao" aria-label="Dados da reserva">
        <p><strong>{rotuloStatus(reserva.status)}</strong></p>
        <p>Retirada: {formatarDataHora(reserva.inicio)}<br />Devolução: {formatarDataHora(reserva.fim)}</p>
        <p>Motorista: {nome(reserva.motorista_id)}</p>
        {reserva.finalidade && <p>Finalidade: {reserva.finalidade}</p>}
        {reserva.destino && <p>Destino: {reserva.destino}</p>}
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
              <strong>{rotuloStatus(e.para_status)}</strong> · {formatarDataHora(e.em)} · {nome(e.ator_id)}
              {typeof e.detalhe.justificativa === 'string' && e.detalhe.justificativa && <><br />Justificativa: {e.detalhe.justificativa}</>}
              {e.detalhe.cancelamento_tardio === true && <><br />Cancelamento fora do prazo da política.</>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
