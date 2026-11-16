import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Veiculo } from '../components/Placa'
import { mensagemDeErro } from '../lib/erros'
import { assistenciaDoCarro, baixarAssistencia, registrarOcorrencia, TIPOS_OCORRENCIA } from '../lib/ocorrencias'
import type { Assistencia, TipoOcorrencia } from '../lib/ocorrencias'
import { reservasLocais } from '../lib/offline'
import { supabase } from '../lib/supabase'

type Reserva = { id: string; empresa_id: string; status: string; veiculos: { placa: string; modelo: string } | null }
type Local = { latitude: number; longitude: number; precisao: number } | null

function Emergencia() {
  return (
    <section className="cartao emergencia" aria-label="Emergência">
      <h2>Ligue primeiro para o socorro</h2>
      <p>Se alguém se feriu, peça ajuda antes de registrar. Não mova a vítima.</p>
      <div className="acoes">
        <a className="botao perigo" href="tel:192">SAMU 192</a>
        <a className="botao perigo" href="tel:193">Bombeiros 193</a>
        <a className="botao perigo" href="tel:190">Polícia 190</a>
      </div>
    </section>
  )
}

function CartaoAssistencia({ a }: { a: Assistencia | null }) {
  if (!a) return <p>Nenhum telefone de assistência cadastrado. Ligue para o gestor da frota.</p>
  return (
    <div className="assistencia">
      <p style={{ margin: 0 }}><strong>{a.seguradora ?? 'Assistência'}</strong>{a.apolice ? `, apólice ${a.apolice}` : ''}</p>
      {a.observacao && <p style={{ margin: '4px 0 0' }}>{a.observacao}</p>}
      <p style={{ margin: '10px 0 0' }}><a className="botao" href={`tel:${a.telefone_assistencia.replace(/[^\d+]/g, '')}`}>Ligar para a assistência: {a.telefone_assistencia}</a></p>
    </div>
  )
}

export default function Ocorrencia() {
  const { id } = useParams()
  const [reserva, setReserva] = useState<Reserva | null | undefined>(undefined)
  const [tipo, setTipo] = useState<TipoOcorrencia | null>(null)
  const [local, setLocal] = useState<Local>(null)
  const [buscandoLocal, setBuscandoLocal] = useState(true)
  const [endereco, setEndereco] = useState('')
  const [descricao, setDescricao] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [assistencia, setAssistencia] = useState<Assistencia | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState<'enviada' | 'guardada' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const doAparelho = async () => {
      const l = (await reservasLocais()).find((x) => x.id === id)
      setReserva(l ? { id: l.id, empresa_id: l.empresa_id, status: l.status, veiculos: { placa: l.placa, modelo: l.modelo } } : null)
    }
    if (!navigator.onLine) { void doAparelho(); return }
    supabase.from('reservas').select('id, empresa_id, status, veiculos(placa, modelo)').eq('id', id ?? '').maybeSingle<Reserva>()
      .then(async ({ data, error }) => {
        if (error) return doAparelho()
        setReserva(data ?? null)
        if (data) await baixarAssistencia(data.empresa_id)
      })
  }, [id])

  useEffect(() => {
    if (reserva) void assistenciaDoCarro(reserva.veiculos?.placa).then(setAssistencia)
  }, [reserva])

  useEffect(() => {
    if (!('geolocation' in navigator)) { setBuscandoLocal(false); return }
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocal({ latitude: p.coords.latitude, longitude: p.coords.longitude, precisao: Math.round(p.coords.accuracy) }); setBuscandoLocal(false) },
      () => setBuscandoLocal(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }, [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!reserva || !tipo) return
    if (!local && !endereco.trim()) return setErro('Sem a localização do celular: escreva onde você está.')
    setErro(null)
    setEnviando(true)
    try {
      const r = await registrarOcorrencia({
        reserva: reserva.id, empresa: reserva.empresa_id, tipo, descricao, endereco,
        latitude: local?.latitude ?? null, longitude: local?.longitude ?? null, precisao: local?.precisao ?? null, arquivos,
      })
      if (r.resultado === 'recusada') setErro(mensagemDeErro(r.erro))
      else { setFeito(r.resultado); if (r.assistencia) setAssistencia(r.assistencia) }
    } catch {
      setErro('Não foi possível registrar. Ligue para o gestor da frota.')
    }
    setEnviando(false)
  }

  if (reserva === undefined) return <main><p>Carregando…</p></main>
  if (reserva === null) return <main><p role="alert" className="erro">Reserva não encontrada.</p><Link to="/reservas">Voltar</Link></main>

  if (feito) {
    return (
      <main style={{ maxWidth: 640 }}>
        <h1>Ocorrência registrada</h1>
        {tipo === 'acidente_com_vitima' && <Emergencia />}
        <section className="cartao" aria-label="Próximos passos">
          <p role="status" className="sucesso">
            {feito === 'enviada'
              ? 'A gestão da frota foi avisada e o carro foi retirado das reservas.'
              : 'Você está sem sinal. A ocorrência ficou guardada no celular e será enviada assim que a conexão voltar. Se puder, ligue para o gestor.'}
          </p>
          <h2>Assistência</h2>
          <CartaoAssistencia a={assistencia} />
          <p style={{ marginTop: 16 }}>Fique em local seguro. O gestor vai combinar o que fazer com o carro e encerrar a reserva.</p>
          <p><Link to={`/reservas/${reserva.id}`}>Voltar para a reserva</Link></p>
        </section>
      </main>
    )
  }

  if (!['em_uso', 'atrasada', 'ocorrencia'].includes(reserva.status)) {
    return <main><p role="alert" className="erro">A ocorrência só pode ser registrada enquanto o carro está com você.</p><Link to={`/reservas/${reserva.id}`}>Voltar</Link></main>
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <p><Link to={`/reservas/${reserva.id}`}>← Voltar para a reserva</Link></p>
      <h1>Pane ou acidente</h1>
      <p><Veiculo placa={reserva.veiculos?.placa} modelo={reserva.veiculos?.modelo} /></p>
      {tipo === 'acidente_com_vitima' && <Emergencia />}
      <form onSubmit={enviar}>
        <section className="cartao" aria-label="O que aconteceu">
          <h2>O que aconteceu?</h2>
          <div className="opcoes-ocorrencia" role="radiogroup" aria-label="Tipo de ocorrência">
            {TIPOS_OCORRENCIA.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={tipo === t.id}
                className={tipo === t.id ? 'opcao escolhida' : 'opcao'} onClick={() => setTipo(t.id)}>
                <strong>{t.rotulo}</strong><small>{t.ajuda}</small>
              </button>
            ))}
          </div>
        </section>
        {tipo && (
          <>
            <section className="cartao" aria-label="Assistência">
              <h2>Assistência</h2>
              <CartaoAssistencia a={assistencia} />
            </section>
            <section className="cartao" aria-label="Onde você está">
              <h2>Onde você está</h2>
              <p role="status">
                {buscandoLocal ? 'Buscando a localização do celular…'
                  : local ? `Localização do celular obtida (precisão de ${local.precisao} m).`
                  : 'Não foi possível pegar a localização do celular. Escreva o endereço ou um ponto de referência.'}
              </p>
              <label>Endereço ou referência{local ? ' (opcional)' : ''}
                <input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, cidade ou ponto de referência" />
              </label>
            </section>
            <section className="cartao" aria-label="Detalhes">
              <h2>Detalhes (opcional)</h2>
              <label>Descrição
                <textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </label>
              <label style={{ marginTop: 12 }}>Fotos
                <input type="file" accept="image/*" multiple capture="environment" onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 6))} />
              </label>
              {arquivos.length > 0 && <small>{arquivos.length} foto{arquivos.length > 1 ? 's' : ''} escolhida{arquivos.length > 1 ? 's' : ''}.</small>}
            </section>
            {erro && <p role="alert" className="erro">{erro}</p>}
            <p><button type="submit" className="perigo" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar ocorrência'}</button></p>
          </>
        )}
      </form>
    </main>
  )
}
