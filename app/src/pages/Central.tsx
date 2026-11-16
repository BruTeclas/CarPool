import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Placa } from '../components/Placa'
import { useEmpresa } from '../lib/empresa'
import { rotuloOcorrencia } from '../lib/ocorrencias'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Reserva = {
  id: string; inicio: string; fim: string; status: string; motorista_id: string
  veiculos: { placa: string; modelo: string } | null
}
type Incidente = { id: string; tipo: string; registrada_em: string; veiculos: { placa: string } | null }

const hora = (s: string) => new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const diaBr = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

/** Tela da portaria para tablet ou TV: agenda do dia, carros na rua e alertas, atualizada em tempo real. */
export default function Central() {
  const { empresaId, empresaNome, podeOperar, carregando } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [incidentes, setIncidentes] = useState<Incidente[]>([])
  const [agora, setAgora] = useState(() => new Date())
  const [aoVivo, setAoVivo] = useState(false)
  const [atualizado, setAtualizado] = useState<Date | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const fimDoDia = new Date(); fimDoDia.setHours(23, 59, 59, 999)
    const [r, i] = await Promise.all([
      supabase.from('reservas').select('id, inicio, fim, status, motorista_id, veiculos(placa, modelo)')
        .eq('empresa_id', empresaId).in('status', ['aprovada', 'liberada', 'em_uso', 'atrasada', 'ocorrencia', 'devolvida'])
        .lte('inicio', fimDoDia.toISOString()).order('inicio').returns<Reserva[]>(),
      supabase.from('incidentes').select('id, tipo, registrada_em, veiculos(placa)').eq('empresa_id', empresaId).eq('status', 'aberta')
        .order('registrada_em').returns<Incidente[]>(),
    ])
    if (!r.error) setReservas(r.data ?? [])
    if (!i.error) setIncidentes(i.data ?? [])
    setAtualizado(new Date())
  }, [empresaId])

  useEffect(() => {
    if (!empresaId) return
    void carregar()
    const canal = supabase.channel(`central-${empresaId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas', filter: `empresa_id=eq.${empresaId}` }, () => void carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidentes', filter: `empresa_id=eq.${empresaId}` }, () => void carregar())
      .subscribe((estado) => setAoVivo(estado === 'SUBSCRIBED'))
    const reserva = setInterval(() => void carregar(), 60000) // se o tempo real cair, a tela ainda se atualiza
    return () => { clearInterval(reserva); void supabase.removeChannel(canal) }
  }, [empresaId, carregar])

  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 15000); return () => clearInterval(t) }, [])

  if (carregando) return <main className="central"><p>Carregando…</p></main>
  if (!podeOperar) return <main className="central"><p role="alert" className="erro">Você não tem acesso à central da portaria.</p><Link to="/">Voltar</Link></main>

  const nome = (uid: string) => pessoas.find((p) => p.valor === uid)?.rotulo ?? ''
  const hojeBr = diaBr(agora)
  const ehHoje = (s: string) => diaBr(new Date(s)) === hojeBr
  const saidas = reservas.filter((r) => ['aprovada', 'liberada'].includes(r.status))
  const naRua = reservas.filter((r) => r.status === 'em_uso')
  const voltam = naRua.filter((r) => ehHoje(r.fim))
  const atencao = reservas.filter((r) => ['atrasada', 'ocorrencia', 'devolvida'].includes(r.status))

  const Linha = ({ r, quando }: { r: Reserva; quando: string }) => (
    <li className="central-linha">
      <span className="central-hora">{quando}</span>
      <span className="central-carro"><Placa valor={r.veiculos?.placa} /><span>{r.veiculos?.modelo}</span></span>
      <span className="central-pessoa">{nome(r.motorista_id)}</span>
    </li>
  )

  return (
    <main className="central">
      <header className="central-topo">
        <div>
          <h1>Portaria</h1>
          <p>{empresaNome}, {agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })}</p>
        </div>
        <div className="central-status">
          <strong className="central-relogio">{hora(agora.toISOString())}</strong>
          <span className={aoVivo ? 'ao-vivo' : 'sem-sinal'}>{aoVivo ? 'Ao vivo' : `Atualizado às ${atualizado ? hora(atualizado.toISOString()) : '--:--'}`}</span>
          <button type="button" className="secundario" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}>Tela cheia</button>
          <Link to="/portaria">Sair</Link>
        </div>
      </header>

      {(incidentes.length > 0 || atencao.length > 0) && (
        <section className="central-alertas" aria-label="Atenção">
          {incidentes.map((i) => <p key={i.id} className="central-alerta grave">{rotuloOcorrencia(i.tipo)} com o <Placa valor={i.veiculos?.placa} /> desde {hora(i.registrada_em)}</p>)}
          {atencao.filter((r) => r.status === 'atrasada').map((r) => (
            <p key={r.id} className="central-alerta">Devolução atrasada: <Placa valor={r.veiculos?.placa} /> com {nome(r.motorista_id)}, previsto para {hora(r.fim)}</p>
          ))}
          {atencao.filter((r) => r.status === 'devolvida').map((r) => (
            <p key={r.id} className="central-alerta leve">Aguardando conferência: <Placa valor={r.veiculos?.placa} /> devolvido por {nome(r.motorista_id)}</p>
          ))}
        </section>
      )}

      <div className="central-colunas">
        <section aria-label="Saídas de hoje">
          <h2>Saídas <span>{saidas.length}</span></h2>
          {saidas.length === 0 ? <p className="vazio">Nenhuma retirada prevista.</p> : (
            <ul>{saidas.map((r) => <Linha key={r.id} r={r} quando={new Date(r.inicio) < agora ? `${hora(r.inicio)} · aguardando` : hora(r.inicio)} />)}</ul>
          )}
        </section>
        <section aria-label="Na rua">
          <h2>Na rua <span>{naRua.length}</span></h2>
          {naRua.length === 0 ? <p className="vazio">Nenhum carro fora.</p> : (
            <ul>{naRua.map((r) => <Linha key={r.id} r={r} quando={`até ${ehHoje(r.fim) ? hora(r.fim) : diaBr(new Date(r.fim))}`} />)}</ul>
          )}
        </section>
        <section aria-label="Voltam hoje">
          <h2>Voltam hoje <span>{voltam.length}</span></h2>
          {voltam.length === 0 ? <p className="vazio">Nenhuma devolução prevista.</p> : (
            <ul>{voltam.map((r) => <Linha key={r.id} r={r} quando={hora(r.fim)} />)}</ul>
          )}
        </section>
      </div>
    </main>
  )
}
