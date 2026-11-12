import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Veiculo } from '../components/Placa'
import { formatarDataHora } from '../lib/datas'
import { baixarPacote, lerChaveSemSinal, semSinal } from '../lib/offline'
import type { Leitura } from '../lib/offline'
import { supabase } from '../lib/supabase'

/** Página aberta ao ler o QR da chave (o QR aponta para /k/<código>). */
export default function Chave() {
  const { codigo = '' } = useParams()
  const { session, carregando } = useAuth()
  const [ficha, setFicha] = useState<{ modelo: string; base: string } | null | undefined>(undefined)
  const [leitura, setLeitura] = useState<Leitura | null>(null)
  const [erro, setErro] = useState(false)
  const lido = useRef(false)

  useEffect(() => {
    if (carregando) return
    if (!session) {
      supabase.rpc('ficha_veiculo', { p_codigo: codigo }).then(({ data }) => setFicha(data ?? null))
      return
    }
    if (lido.current) return // cada abertura da página conta como uma leitura só
    lido.current = true
    const lerSemSinal = () => lerChaveSemSinal(codigo).then(setLeitura).catch(() => setErro(true))
    if (!navigator.onLine) { void lerSemSinal(); return }
    supabase.rpc('ler_chave', { p_codigo: codigo }).then(({ data, error }) => {
      if (error && semSinal(error)) void lerSemSinal()
      else if (error) setErro(true)
      else { setLeitura(data as Leitura); void baixarPacote() }
    })
  }, [carregando, session, codigo])

  const carro = leitura?.placa ? <Veiculo placa={leitura.placa} modelo={leitura.modelo} /> : null

  function conteudo() {
    if (!session) {
      if (ficha === undefined) return <p>Carregando…</p>
      if (ficha === null) return <p role="alert" className="erro">{navigator.onLine ? 'Etiqueta não reconhecida.' : 'Sem sinal. Entre no sistema quando houver internet para usar este aparelho sem sinal depois.'}</p>
      return (
        <>
          <p>Veículo de frota: <strong>{ficha.modelo}</strong><br />Base: {ficha.base}</p>
          <p><Link to={`/entrar?voltar=/k/${codigo}`}>Entrar para retirar ou devolver este veículo</Link></p>
        </>
      )
    }
    if (erro) return <p role="alert" className="erro">Não foi possível ler a chave. Verifique o sinal e tente de novo.</p>
    if (!leitura) return <p>Conferindo sua reserva…</p>
    const detalhe = leitura.reserva_id ? `/reservas/${leitura.reserva_id}` : '/reservas'
    switch (leitura.resultado) {
      case 'chave_certa':
        return (
          <>
            <p role="status" className="sucesso"><strong>Chave certa.</strong> {carro}</p>
            <p>{leitura.offline ? 'Você está sem sinal: a retirada ficou guardada neste aparelho e será enviada quando o sinal voltar.' : 'Retirada registrada.'} Antes de sair, faça a vistoria de saída.</p>
            <Link className="botao" to={`/reservas/${leitura.reserva_id}/vistoria/saida`}>Iniciar vistoria de saída</Link>
          </>
        )
      case 'devolucao':
        return (
          <>
            <p role="status"><strong>Devolução.</strong> {carro}</p>
            <p>Estacione na base e faça a vistoria de chegada para encerrar.</p>
            <Link className="botao" to={`/reservas/${leitura.reserva_id}/vistoria/chegada`}>Iniciar vistoria de chegada</Link>
          </>
        )
      case 'chave_errada':
        return (
          <>
            <p role="alert" className="erro"><strong>Essa não é a chave da sua reserva.</strong></p>
            <p>Sua reserva é do veículo <strong>{carro}</strong>. Devolva esta chave e pegue a correta. A tentativa foi registrada.</p>
            <Link to={detalhe}>Ver minha reserva</Link>
          </>
        )
      case 'antes_da_janela':
        return (
          <>
            <p role="status"><strong>Ainda é cedo.</strong> {carro}</p>
            <p>Sua reserva começa {leitura.inicio && formatarDataHora(leitura.inicio)}. A retirada abre 15 minutos antes.</p>
            <Link to={detalhe}>Ver minha reserva</Link>
          </>
        )
      case 'fora_da_janela':
        return (
          <>
            <p role="alert" className="erro"><strong>O prazo de retirada passou.</strong></p>
            <p>{leitura.offline ? 'O horário de retirada da sua reserva já passou. Procure a portaria ou faça uma nova reserva quando houver sinal.' : 'A reserva foi encerrada como não retirada. Faça uma nova reserva.'}</p>
            <Link to="/reservar">Reservar</Link>
          </>
        )
      case 'sem_sinal':
        return <p role="alert" className="erro"><strong>Sem sinal, e essa chave não é de nenhuma reserva guardada neste aparelho.</strong> Procure a portaria ou tente de novo quando houver internet.</p>
      case 'cnh_invalida':
        return <p role="alert" className="erro"><strong>Sua CNH está vencida ou não cadastrada.</strong> Procure o gestor da frota antes de retirar o veículo.</p>
      case 'veiculo_bloqueado':
        return <p role="alert" className="erro"><strong>Este veículo está bloqueado.</strong> Procure a portaria ou o gestor da frota.</p>
      case 'sem_reserva':
        return (
          <>
            <p role="alert" className="erro"><strong>Você não tem reserva para este veículo agora.</strong> {carro}</p>
            <p>{leitura.livre_agora ? 'Ele está livre nas próximas horas.' : 'Ele está reservado ou indisponível agora.'}</p>
            <Link to="/reservar">Fazer uma reserva</Link>
          </>
        )
      default:
        return <p role="alert" className="erro">Etiqueta não reconhecida.</p>
    }
  }

  return (
    <main style={{ maxWidth: 520 }}>
      <h1>Chave do veículo</h1>
      <section className="cartao" aria-label="Leitura da chave">{conteudo()}</section>
      {session && <p><Link to="/reservas">Minhas reservas</Link></p>}
    </main>
  )
}
