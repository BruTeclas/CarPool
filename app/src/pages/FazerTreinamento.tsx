import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LeitorPdf } from '../components/LeitorPdf'
import { avisarMudanca } from '../lib/avisos'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'
import { baixarCertificado, carregarYoutube, duracao, relogio, SITUACAO_DA_TENTATIVA, TIPOS_DE_ETAPA, urlDoArquivo } from '../lib/treinamentos'
import type { Conteudo, EtapaDoColaborador, TentativaAberta, YTPlayer } from '../lib/treinamentos'

const INTERVALO_SINAL_MS = 5000
const RESPOSTA_PRESENCA_S = 30

/** Intervalo até o próximo "Você está aí?": sorteado entre 2 e 5 minutos.
 *  Só em desenvolvimento dá para encurtar (localStorage carpool.presenca_seg) para testar. */
function proximaPresencaMs(): number {
  if (import.meta.env.DEV) {
    try { const s = Number(localStorage.getItem('carpool.presenca_seg')); if (s > 0) return s * 1000 } catch { /* sem storage */ }
  }
  return (120 + Math.random() * 180) * 1000
}

type Sinal = { segundos: number; pendentes: number; minimo: number; posicao_max: number; posicao_permitida: number | null; concluida: boolean; pronta: boolean }

/** Controle do conteúdo que está aberto: o vídeo informa posição e se está tocando; texto e PDF, se chegou ao fim */
type Controle = { posicao: () => number; tocouDesdeUltimo: () => boolean; pausar: () => void; voltarPara: (s: number) => void; chegouAoFim: () => boolean }

// ------------------------------------------------------------ telemetria
function useTelemetria(etapa: EtapaDoColaborador, controle: React.RefObject<Controle | null>, aoConcluir: () => void) {
  const sessao = useMemo(() => crypto.randomUUID(), [])
  const [contado, setContado] = useState(Number(etapa.segundos) + Number(etapa.pendentes))
  const [pergunta, setPergunta] = useState<null | 'presenca' | 'concluir' | 'pausado'>(null)
  const [restante, setRestante] = useState(RESPOSTA_PRESENCA_S)
  const [erro, setErro] = useState<string | null>(null)
  const proxima = useRef(Date.now() + proximaPresencaMs())
  const perguntaRef = useRef(pergunta)
  useEffect(() => { perguntaRef.current = pergunta })
  const concluir = useRef(aoConcluir)
  useEffect(() => { concluir.current = aoConcluir })

  const enviar = useCallback(async () => {
    const c = controle.current
    if (!c) return
    const { data, error } = await supabase.rpc('sinal_etapa', {
      p_etapa: etapa.id, p_sessao: sessao, p_posicao: c.posicao(), p_tocando: c.tocouDesdeUltimo() && document.visibilityState === 'visible', p_fim: c.chegouAoFim(),
    })
    if (error) { setErro(mensagemDeErro(error)); return }
    setErro(null)
    const s = data as Sinal
    setContado(Number(s.segundos) + Number(s.pendentes))
    if (s.posicao_permitida !== null && s.posicao_permitida !== undefined) c.voltarPara(Number(s.posicao_permitida))
    if (s.concluida) concluir.current()
    else if (s.pronta && !perguntaRef.current) setPergunta('concluir')
  }, [controle, etapa.id, sessao])

  // sinal a cada 5 s; ao esconder a tela, pausa e manda na hora
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void enviar()
      if (!perguntaRef.current && Date.now() >= proxima.current) { setRestante(RESPOSTA_PRESENCA_S); setPergunta('presenca') }
    }, INTERVALO_SINAL_MS)
    const aoMudar = () => { if (document.visibilityState !== 'visible') { controle.current?.pausar(); void enviar() } }
    document.addEventListener('visibilitychange', aoMudar)
    void enviar()
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', aoMudar) }
  }, [enviar, controle])

  // 30 s para responder; sem resposta, pausa
  useEffect(() => {
    if (pergunta !== 'presenca' && pergunta !== 'concluir') return
    const id = window.setInterval(() => setRestante((r) => r - 1), 1000)
    return () => window.clearInterval(id)
  }, [pergunta])
  useEffect(() => {
    if (restante <= 0 && (pergunta === 'presenca' || pergunta === 'concluir')) { controle.current?.pausar(); setPergunta('pausado') }
  }, [restante, pergunta, controle])

  async function confirmar() {
    await enviar()
    const { data, error } = await supabase.rpc('confirmar_presenca', { p_etapa: etapa.id })
    if (error) { setErro(mensagemDeErro(error)); return }
    proxima.current = Date.now() + proximaPresencaMs()
    setPergunta(null)
    setRestante(RESPOSTA_PRESENCA_S)
    const r = data as { segundos: number; concluida: boolean }
    setContado(Number(r.segundos))
    if (r.concluida) concluir.current()
  }

  return { contado, pergunta, restante, erro, confirmar, enviar }
}

function PerguntaDePresenca({ tipo, restante, aoConfirmar }: { tipo: 'presenca' | 'concluir' | 'pausado'; restante: number; aoConfirmar: () => void }) {
  const botao = useRef<HTMLButtonElement>(null)
  useEffect(() => { botao.current?.focus() }, [tipo])
  const textos = {
    presenca: { titulo: 'Você está aí?', corpo: `Confirme em ${restante} s para o tempo deste trecho contar.`, botao: 'Estou aqui' },
    concluir: { titulo: 'Tempo mínimo cumprido', corpo: `Confirme em ${restante} s para concluir esta etapa.`, botao: 'Concluir etapa' },
    pausado: { titulo: 'Pausamos o conteúdo', corpo: 'Você não respondeu a tempo, então o trecho desde a última confirmação pode não ter contado.', botao: 'Continuar' },
  }[tipo]
  return (
    <div className="popup-fundo">
      <div className="popup" role="alertdialog" aria-modal="true" aria-labelledby="presenca-titulo" aria-describedby="presenca-corpo">
        <h2 id="presenca-titulo">{textos.titulo}</h2>
        <p id="presenca-corpo" aria-live="polite">{textos.corpo}</p>
        <div className="acoes popup-acoes"><button ref={botao} type="button" onClick={aoConfirmar}>{textos.botao}</button></div>
      </div>
    </div>
  )
}

function Cronometro({ contado, minimo, concluida }: { contado: number; minimo: number; concluida: boolean }) {
  const pct = Math.min(100, (contado / minimo) * 100)
  return (
    <div className="cronometro" aria-label="Tempo contado">
      <div className="barra-trilho"><div className="barra-valor" style={{ width: `${concluida ? 100 : pct}%` }} /></div>
      <small>{concluida ? 'Etapa concluída.' : `Tempo contado: ${relogio(Math.min(contado, minimo))} de ${relogio(minimo)}. Só conta com esta tela aberta e à vista.`}</small>
    </div>
  )
}

// ------------------------------------------------------------ conteúdos
function EtapaVideo({ etapa, aoConcluir }: { etapa: EtapaDoColaborador; aoConcluir: () => void }) {
  const controle = useRef<Controle | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const lugarYt = useRef<HTMLDivElement>(null)
  const yt = useRef<YTPlayer | null>(null)
  const maximo = useRef(Number(etapa.posicao_max))
  const tocou = useRef(false)
  const [url, setUrl] = useState<string | null>(null)
  const [tocando, setTocando] = useState(false)
  const [posicao, setPosicao] = useState(Number(etapa.posicao_max))
  const [erroVideo, setErroVideo] = useState(false)
  const concluida = !!etapa.concluida_em
  const t = useTelemetria(etapa, controle, aoConcluir)
  const total = etapa.duracao_seg ?? etapa.tempo_minimo_seg

  useEffect(() => {
    const atual = () => (etapa.tipo === 'youtube' ? yt.current?.getCurrentTime() ?? 0 : video.current?.currentTime ?? 0)
    controle.current = {
      posicao: atual,
      tocouDesdeUltimo: () => { const r = tocou.current; tocou.current = tocandoAgora(); return r },
      pausar: () => { if (etapa.tipo === 'youtube') yt.current?.pauseVideo(); else video.current?.pause() },
      voltarPara: (s) => { maximo.current = s; if (etapa.tipo === 'youtube') yt.current?.seekTo(s, true); else if (video.current) video.current.currentTime = s },
      chegouAoFim: () => false,
    }
    function tocandoAgora() {
      if (etapa.tipo === 'youtube') return yt.current?.getPlayerState() === 1
      return !!video.current && !video.current.paused && !video.current.ended
    }
  }, [etapa.tipo])

  // arquivo enviado
  useEffect(() => {
    if (etapa.tipo === 'video' && etapa.arquivo_caminho) void urlDoArquivo(etapa.arquivo_caminho).then(setUrl)
  }, [etapa.tipo, etapa.arquivo_caminho])

  // YouTube sem os controles de adiantar
  useEffect(() => {
    if (etapa.tipo !== 'youtube' || !etapa.youtube_id) return
    let vivo = true
    carregarYoutube().then((YT) => {
      if (!vivo || !lugarYt.current) return
      const alvo = document.createElement('div')
      lugarYt.current.replaceChildren(alvo)
      yt.current = new YT.Player(alvo, {
        videoId: etapa.youtube_id, width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3, playsinline: 1, start: Math.floor(maximo.current) },
        events: {
          onStateChange: (e: { data: number }) => { setTocando(e.data === 1); if (e.data === 1) tocou.current = true; if (e.data === 0) void t.enviar() },
          onError: () => setErroVideo(true),
        },
      })
    }).catch(() => setErroVideo(true))
    return () => { vivo = false; yt.current?.destroy(); yt.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa.tipo, etapa.youtube_id])

  // vigia: não deixa passar do ponto já assistido nem acelerar
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = etapa.tipo === 'youtube' ? yt.current : null
      const agora = p ? p.getCurrentTime?.() ?? 0 : video.current?.currentTime ?? 0
      if (agora > maximo.current + 2 && !concluida) {
        if (p) p.seekTo(maximo.current, true); else if (video.current) video.current.currentTime = maximo.current
      } else if (tocandoAgoraRapido()) {
        maximo.current = Math.max(maximo.current, agora)
      }
      if (p && p.getPlaybackRate?.() !== 1) p.setPlaybackRate(1)
      setPosicao(agora)
    }, 500)
    function tocandoAgoraRapido() {
      if (etapa.tipo === 'youtube') return yt.current?.getPlayerState?.() === 1
      return !!video.current && !video.current.paused
    }
    return () => window.clearInterval(id)
  }, [etapa.tipo, concluida])

  function alternar() {
    if (etapa.tipo === 'youtube') { if (tocando) yt.current?.pauseVideo(); else yt.current?.playVideo(); return }
    const v = video.current
    if (!v) return
    if (v.paused) void v.play(); else v.pause()
  }

  return (
    <>
      <div className="video-quadro">
        {etapa.tipo === 'youtube'
          ? <div ref={lugarYt} className="video-yt" />
          : url && (
            <video ref={video} src={url} playsInline preload="metadata" controlsList="nodownload noplaybackrate" disablePictureInPicture
              onPlay={() => { setTocando(true); tocou.current = true }} onPause={() => setTocando(false)} onEnded={() => { setTocando(false); void t.enviar() }}
              onRateChange={(e) => { e.currentTarget.playbackRate = 1 }}
              onSeeking={(e) => { if (!concluida && e.currentTarget.currentTime > maximo.current + 1) e.currentTarget.currentTime = maximo.current }}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = Math.min(maximo.current, e.currentTarget.duration || 0) }}
              onError={() => setErroVideo(true)} />
          )}
      </div>
      {erroVideo && <p role="alert" className="erro">Não foi possível tocar o vídeo. Confira a internet e tente de novo.</p>}
      <div className="video-controles">
        <button type="button" onClick={alternar} aria-pressed={tocando}>{tocando ? 'Pausar' : posicao > 0 ? 'Continuar' : 'Assistir'}</button>
        <span className="video-tempo" aria-label="Posição do vídeo">{relogio(posicao)} / {relogio(total)}</span>
        <small>Não é possível adiantar o vídeo.</small>
      </div>
      <Cronometro contado={t.contado} minimo={etapa.tempo_minimo_seg} concluida={concluida} />
      {t.erro && <p role="alert" className="erro">{t.erro}</p>}
      {t.pergunta && !concluida && <PerguntaDePresenca tipo={t.pergunta} restante={t.restante} aoConfirmar={() => void t.confirmar()} />}
    </>
  )
}

function EtapaLeitura({ etapa, aoConcluir }: { etapa: EtapaDoColaborador; aoConcluir: () => void }) {
  const controle = useRef<Controle | null>(null)
  const fim = useRef(etapa.fim_alcancado)
  const marcador = useRef<HTMLDivElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [noFim, setNoFim] = useState(etapa.fim_alcancado)
  const concluida = !!etapa.concluida_em
  const t = useTelemetria(etapa, controle, aoConcluir)

  useEffect(() => {
    controle.current = { posicao: () => 0, tocouDesdeUltimo: () => true, pausar: () => {}, voltarPara: () => {}, chegouAoFim: () => fim.current }
  }, [])
  useEffect(() => {
    if (etapa.tipo === 'pdf' && etapa.arquivo_caminho) void urlDoArquivo(etapa.arquivo_caminho).then(setUrl)
  }, [etapa.tipo, etapa.arquivo_caminho])
  useEffect(() => {
    if (etapa.tipo !== 'texto' || !marcador.current) return
    // o fim conta quando aparece dentro da caixa de leitura (que tem rolagem própria)
    const o = new IntersectionObserver((itens) => { if (itens.some((i) => i.isIntersecting)) { fim.current = true; setNoFim(true) } }, { root: caixa.current })
    o.observe(marcador.current)
    return () => o.disconnect()
  }, [etapa.tipo])

  return (
    <>
      {etapa.tipo === 'texto'
        ? <div className="leitura" ref={caixa} tabIndex={0} aria-label="Texto da etapa"><p className="comunicado-texto">{etapa.texto}</p><div ref={marcador} className="leitor-fim">Fim do texto</div></div>
        : url ? <LeitorPdf url={url} aoChegarAoFim={() => { fim.current = true; setNoFim(true) }} /> : <p>Abrindo o PDF…</p>}
      <div className="cronometro-fixo">
        <Cronometro contado={t.contado} minimo={etapa.tempo_minimo_seg} concluida={concluida} />
        {!concluida && !noFim && <small>Leia até o fim para concluir.</small>}
      </div>
      {t.erro && <p role="alert" className="erro">{t.erro}</p>}
      {t.pergunta && !concluida && <PerguntaDePresenca tipo={t.pergunta} restante={t.restante} aoConfirmar={() => void t.confirmar()} />}
    </>
  )
}

// ------------------------------------------------------------ prova
type Resultado = { status: string; nota: number | null; acertos: number; total: number; nota_minima: number }

function Prova({ treinamentoId, aoTerminar }: { treinamentoId: string; aoTerminar: () => void }) {
  const [prova, setProva] = useState<TentativaAberta | null>(null)
  const [respostas, setRespostas] = useState<Record<string, string[] | string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function comecar() {
    setErro(null)
    const { data, error } = await supabase.rpc('iniciar_prova', { p_treinamento: treinamentoId })
    if (error) return setErro(mensagemDeErro(error))
    setProva(data as TentativaAberta)
    setRespostas({})
  }

  function marcar(pergunta: string, alt: string, varias: boolean) {
    setRespostas((r) => {
      const atuais = Array.isArray(r[pergunta]) ? (r[pergunta] as string[]) : []
      return { ...r, [pergunta]: varias ? (atuais.includes(alt) ? atuais.filter((a) => a !== alt) : [...atuais, alt]) : [alt] }
    })
  }

  async function enviar() {
    if (!prova) return
    const faltam = prova.perguntas.filter((p) => { const r = respostas[p.id]; return !r || (Array.isArray(r) ? r.length === 0 : !r.trim()) }).length
    if (faltam && !window.confirm(`${faltam} ${faltam === 1 ? 'pergunta está' : 'perguntas estão'} sem resposta. Enviar mesmo assim?`)) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('enviar_prova', { p_tentativa: prova.id, p_respostas: respostas })
    setEnviando(false)
    if (error) return setErro(mensagemDeErro(error))
    setResultado(data as Resultado)
    avisarMudanca()
  }

  if (resultado) {
    const aprovado = resultado.status === 'aprovada'
    return (
      <section className="cartao" aria-label="Resultado da prova" role="status">
        <h2>{resultado.status === 'aguardando_correcao' ? 'Prova enviada' : aprovado ? 'Aprovado!' : 'Não foi desta vez'}</h2>
        {resultado.status === 'aguardando_correcao'
          ? <p>Há respostas escritas: o gestor vai corrigir e você recebe a nota em Avisos.</p>
          : <p>Nota {Number(resultado.nota).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} (mínimo {resultado.nota_minima}). Você acertou {resultado.acertos} de {resultado.total} {resultado.total === 1 ? 'ponto' : 'pontos'}.</p>}
        <div className="acoes"><button type="button" onClick={aoTerminar}>Voltar ao treinamento</button></div>
      </section>
    )
  }

  if (!prova) {
    return (
      <section className="cartao" aria-label="Prova">
        <h2>Prova</h2>
        <p>Responda com calma. Ao enviar, a nota sai na hora (a não ser que haja resposta escrita, corrigida pelo gestor).</p>
        {erro && <p role="alert" className="erro">{erro}</p>}
        <div className="acoes"><button type="button" onClick={comecar}>Começar a prova</button></div>
      </section>
    )
  }

  return (
    <section className="cartao" aria-label="Prova">
      <h2>Prova · tentativa {prova.numero}</h2>
      <ol className="prova">
        {prova.perguntas.map((p) => (
          <li key={p.id}>
            <fieldset>
              <legend>{p.enunciado}{p.tipo === 'multipla' && <small> (marque todas as certas)</small>}</legend>
              {p.tipo === 'escrita'
                ? <textarea rows={4} aria-label="Sua resposta" value={(respostas[p.id] as string) ?? ''} onChange={(e) => setRespostas({ ...respostas, [p.id]: e.target.value })} />
                : p.alternativas.map((a) => (
                  <label key={a.id} className="linha">
                    <input type={p.tipo === 'multipla' ? 'checkbox' : 'radio'} name={p.id}
                      checked={Array.isArray(respostas[p.id]) && (respostas[p.id] as string[]).includes(a.id)}
                      onChange={() => marcar(p.id, a.id, p.tipo === 'multipla')} />
                    {a.texto}
                  </label>
                ))}
            </fieldset>
          </li>
        ))}
      </ol>
      {erro && <p role="alert" className="erro">{erro}</p>}
      <div className="acoes"><button type="button" onClick={enviar} disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar prova'}</button></div>
    </section>
  )
}

// ------------------------------------------------------------ página
export default function FazerTreinamento() {
  const { id } = useParams()
  const [c, setC] = useState<Conteudo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)
  const [naProva, setNaProva] = useState(false)

  const carregar = useCallback(async () => {
    if (!id) return
    const { data, error } = await supabase.rpc('conteudo_treinamento', { p_treinamento: id })
    if (error) return setErro(mensagemDeErro(error))
    const conteudo = data as Conteudo
    setC(conteudo)
    // abre a primeira etapa ainda não concluída
    setAberta((atual) => atual && conteudo.etapas.find((e) => e.id === atual && !e.concluida_em) ? atual
      : conteudo.etapas.find((e) => !e.concluida_em)?.id ?? null)
  }, [id])

  useEffect(() => { void carregar() }, [carregar])

  if (erro) return <main><p role="alert" className="erro">{erro}</p><p><Link to="/meus-treinamentos">Voltar</Link></p></main>
  if (!c) return <main><p>Carregando…</p></main>

  const { treinamento: t, matricula: m, etapas } = c
  const liberada = (i: number) => etapas.slice(0, i).every((e) => e.concluida_em)
  const etapa = etapas.find((e) => e.id === aberta) ?? null
  const aguardando = c.tentativas.some((x) => x.status === 'aguardando_correcao')
  const aprovado = !!m.aprovado_em && (!m.valido_ate || new Date(m.valido_ate) > new Date())
  const restam = t.tentativas - c.tentativas_usadas
  const podeProva = !!m.conteudo_concluido_em && !aprovado && !aguardando && restam > 0

  return (
    <main className="treinamento">
      <p><Link to="/meus-treinamentos">← Meus treinamentos</Link></p>
      <h1>{t.titulo}</h1>
      {t.descricao && <p>{t.descricao}</p>}
      {m.ciclo > 1 && !m.conteudo_concluido_em && <p role="note" className="popup-alerta">As tentativas da prova acabaram. Refaça o conteúdo para poder tentar de novo.</p>}

      <div className="treinamento-grade">
        <nav aria-label="Etapas do treinamento" className="cartao etapas-nav">
          <ol>
            {etapas.map((e, i) => {
              const ok = !!e.concluida_em, livre = liberada(i)
              return (
                <li key={e.id}>
                  <button type="button" className={`etapa-item${aberta === e.id && !naProva ? ' atual' : ''}`} disabled={!livre}
                    aria-current={aberta === e.id && !naProva ? 'step' : undefined} onClick={() => { setAberta(e.id); setNaProva(false) }}>
                    <span className={`etapa-marca${ok ? ' ok' : ''}`} aria-hidden="true">{ok ? '✓' : livre ? i + 1 : '🔒'}</span>
                    <span><strong>{e.titulo}</strong><small>{TIPOS_DE_ETAPA[e.tipo]} · {duracao(e.tempo_minimo_seg)}{ok ? ' · concluída' : livre ? '' : ' · bloqueada'}</small></span>
                  </button>
                </li>
              )
            })}
            <li>
              <button type="button" className={`etapa-item${naProva ? ' atual' : ''}`} disabled={!m.conteudo_concluido_em && !aprovado} onClick={() => setNaProva(true)}>
                <span className={`etapa-marca${aprovado ? ' ok' : ''}`} aria-hidden="true">{aprovado ? '✓' : '?'}</span>
                <span><strong>Prova</strong><small>{c.perguntas} {c.perguntas === 1 ? 'pergunta' : 'perguntas'} · nota mínima {t.nota_minima}</small></span>
              </button>
            </li>
          </ol>
        </nav>

        <div>
          {naProva ? (
            aprovado ? (
              <section className="cartao" role="status"><h2>Você foi aprovado</h2><p>Nota {Number(m.nota).toLocaleString('pt-BR')}.{m.valido_ate && ` Válido até ${new Date(m.valido_ate).toLocaleDateString('pt-BR')}.`}</p>
                <div className="acoes"><button type="button" onClick={() => void baixarCertificado(t.id)}>Baixar certificado</button></div></section>
            ) : aguardando ? (
              <section className="cartao" role="status"><h2>Prova em correção</h2><p>O gestor está corrigindo suas respostas escritas. Você recebe a nota em Avisos.</p></section>
            ) : podeProva ? (
              <>
                <p>Tentativas restantes: {restam} de {t.tentativas}.</p>
                <Prova treinamentoId={t.id} aoTerminar={() => { setNaProva(false); void carregar() }} />
              </>
            ) : <section className="cartao"><p>Conclua todas as etapas para liberar a prova.</p></section>
          ) : etapa ? (
            <section className="cartao" aria-label={etapa.titulo}>
              <h2>{etapa.titulo}</h2>
              {etapa.tipo === 'youtube' || etapa.tipo === 'video'
                ? <EtapaVideo key={`${etapa.id}-${m.ciclo}`} etapa={etapa} aoConcluir={carregar} />
                : <EtapaLeitura key={`${etapa.id}-${m.ciclo}`} etapa={etapa} aoConcluir={carregar} />}
            </section>
          ) : (
            <section className="cartao" role="status">
              <h2>Conteúdo concluído</h2>
              <p>{aprovado ? 'Você já foi aprovado neste treinamento.' : 'Agora faça a prova.'}</p>
              {!aprovado && <div className="acoes"><button type="button" onClick={() => setNaProva(true)} disabled={!podeProva && !aguardando}>Ir para a prova</button></div>}
            </section>
          )}

          {c.tentativas.filter((x) => x.status !== 'em_andamento').length > 0 && (
            <details className="cartao">
              <summary>Suas tentativas</summary>
              <ul>
                {c.tentativas.filter((x) => x.status !== 'em_andamento').map((x) => (
                  <li key={x.id}>Tentativa {x.numero}: {SITUACAO_DA_TENTATIVA[x.status]}{x.nota !== null && `, nota ${Number(x.nota).toLocaleString('pt-BR')}`}{x.comentario && ` · “${x.comentario}”`}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </main>
  )
}
