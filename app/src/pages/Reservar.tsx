import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'

type Livre = { veiculo_id: string; placa: string; modelo: string }
type Reserva = { id: string; inicio: string; fim: string; status: string; veiculos: { placa: string } | null }

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export default function Reservar() {
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [livres, setLivres] = useState<Livre[] | null>(null)
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('reservas')
      .select('id, inicio, fim, status, veiculos(placa)')
      .order('inicio', { ascending: false })
      .limit(20)
      .returns<Reserva[]>()
    setReservas(data ?? [])
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function buscar(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    const { data, error } = await supabase.rpc('disponibilidade', {
      p_inicio: new Date(inicio).toISOString(),
      p_fim: new Date(fim).toISOString(),
    })
    if (error) setMensagem({ texto: mensagemDeErro(error), erro: true })
    else setLivres(data as Livre[])
  }

  async function reservar(veiculoId: string) {
    const { data, error } = await supabase.rpc('criar_reserva', {
      p_veiculo: veiculoId,
      p_inicio: new Date(inicio).toISOString(),
      p_fim: new Date(fim).toISOString(),
    })
    if (error) return setMensagem({ texto: mensagemDeErro(error), erro: true })
    const status = (data as { status: string }).status
    setMensagem({
      texto: status === 'solicitada' ? 'Reserva enviada para aprovação.' : 'Reserva confirmada.',
      erro: false,
    })
    setLivres(null)
    await carregar()
  }

  async function cancelar(id: string) {
    const { error } = await supabase.rpc('transicionar_reserva', { p_reserva: id, p_para: 'cancelada' })
    if (error) setMensagem({ texto: mensagemDeErro(error), erro: true })
    else await carregar()
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <p><Link to="/">← Meu perfil</Link></p>
      <h1>Reservar veículo</h1>
      <form onSubmit={buscar} style={{ display: 'grid', gap: 8 }}>
        <label>Retirada <input type="datetime-local" required value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label>Devolução <input type="datetime-local" required value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        <button type="submit">Ver veículos livres</button>
      </form>
      {mensagem && (
        <p role={mensagem.erro ? 'alert' : 'status'} style={{ color: mensagem.erro ? '#b00020' : '#1b5e20' }}>{mensagem.texto}</p>
      )}
      {livres && (
        <>
          <h2>Livres nesse período</h2>
          {livres.length === 0 && <p>Nenhum veículo livre. Tente outro horário.</p>}
          <ul>
            {livres.map((l) => (
              <li key={l.veiculo_id}>{l.placa} · {l.modelo} <button onClick={() => reservar(l.veiculo_id)}>Reservar</button></li>
            ))}
          </ul>
        </>
      )}
      <h2>Minhas reservas</h2>
      <ul>
        {reservas.map((r) => (
          <li key={r.id}>
            {r.veiculos?.placa} · {fmt(r.inicio)} → {fmt(r.fim)} · {r.status}
            {['solicitada', 'aprovada'].includes(r.status) && <button onClick={() => cancelar(r.id)}>Cancelar</button>}
          </li>
        ))}
      </ul>
    </main>
  )
}
