import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AcompanhamentoTreinamento } from '../components/AcompanhamentoTreinamento'
import { RegrasTreinamento } from '../components/RegrasTreinamento'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'
import {
  BLOQUEIOS, carregarYoutube, codigoDoYoutube, duracao, duracaoDoArquivo, subirArquivoDeTreinamento, TIPOS_DE_ETAPA, TIPOS_DE_PERGUNTA,
} from '../lib/treinamentos'
import type { Alternativa, Etapa, Pergunta, TipoEtapa, TipoPergunta, Treinamento } from '../lib/treinamentos'

type Mensagem = { texto: string; erro: boolean } | null
const LIMITE_MB = 50

function Retorno({ m }: { m: Mensagem }) {
  return m ? <p role={m.erro ? 'alert' : 'status'} className={m.erro ? 'erro' : 'sucesso'}>{m.texto}</p> : null
}

/** Mostra o vídeo do YouTube para o gestor conferir e devolve a duração */
function PreviaYoutube({ codigo, aoLerDuracao }: { codigo: string; aoLerDuracao: (s: number) => void }) {
  const lugar = useRef<HTMLDivElement>(null)
  const aviso = useRef(aoLerDuracao)
  useEffect(() => { aviso.current = aoLerDuracao })
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let player: { destroy(): void; getDuration(): number } | null = null
    let vivo = true
    carregarYoutube().then((YT) => {
      if (!vivo || !lugar.current) return
      const alvo = document.createElement('div')
      lugar.current.replaceChildren(alvo)
      player = new YT.Player(alvo, {
        videoId: codigo, width: '100%', height: '100%', playerVars: { rel: 0, modestbranding: 1 },
        events: { onReady: () => { const d = player?.getDuration(); if (d) aviso.current(Math.round(d)) }, onError: () => setErro(true) },
      })
    }).catch(() => setErro(true))
    return () => { vivo = false; player?.destroy() }
  }, [codigo])
  if (erro) return <p role="alert" className="erro">Não foi possível abrir esse vídeo. Confira o link e se ele está como “não listado” ou público (vídeo privado não abre).</p>
  return <div className="video-quadro" ref={lugar} />
}

function NovaEtapa({ t, proxima, aoSalvar }: { t: Treinamento; proxima: number; aoSalvar: () => Promise<void> }) {
  const [tipo, setTipo] = useState<TipoEtapa>('youtube')
  const [titulo, setTitulo] = useState('')
  const [link, setLink] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [texto, setTexto] = useState('')
  const [duracaoSeg, setDuracaoSeg] = useState<number | null>(null)
  const [minutos, setMinutos] = useState('2')
  const [msg, setMsg] = useState<Mensagem>(null)
  const [salvando, setSalvando] = useState(false)
  const codigo = tipo === 'youtube' ? codigoDoYoutube(link) : null
  const video = tipo === 'youtube' || tipo === 'video'

  function lerDuracao(s: number) {
    setDuracaoSeg(s)
    setMinutos(String(Math.round((s / 60) * 100) / 100))
  }

  async function escolher(f: File | null) {
    setMsg(null)
    setArquivo(f)
    setDuracaoSeg(null)
    if (!f) return
    if (f.size > LIMITE_MB * 1024 * 1024) { setArquivo(null); return setMsg({ texto: `O arquivo passa de ${LIMITE_MB} MB. Para vídeos longos, use o YouTube como “não listado”.`, erro: true }) }
    if (tipo === 'video') { const d = await duracaoDoArquivo(f); if (d) lerDuracao(d) }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (tipo === 'youtube' && !codigo) return setMsg({ texto: 'Link do YouTube inválido.', erro: true })
    if ((tipo === 'video' || tipo === 'pdf') && !arquivo) return setMsg({ texto: 'Escolha o arquivo.', erro: true })
    const tempo = Math.round(Number(minutos.replace(',', '.')) * 60)
    if (!(tempo >= 10)) return setMsg({ texto: 'O tempo mínimo precisa ser de pelo menos 10 segundos.', erro: true })
    if (video && duracaoSeg && tempo > duracaoSeg) return setMsg({ texto: `O tempo mínimo não pode passar da duração do vídeo (${duracao(duracaoSeg)}).`, erro: true })
    setSalvando(true)
    try {
      const caminho = arquivo ? await subirArquivoDeTreinamento(t.empresa_id, t.id, arquivo) : null
      const { error } = await supabase.from('treinamento_etapas').insert({
        treinamento_id: t.id, empresa_id: t.empresa_id, ordem: proxima, tipo, titulo: titulo.trim(),
        youtube_id: codigo, arquivo_caminho: caminho, texto: tipo === 'texto' ? texto.trim() : null,
        duracao_seg: video ? duracaoSeg : null, tempo_minimo_seg: tempo,
      })
      if (error) throw error
      setTitulo(''); setLink(''); setArquivo(null); setTexto(''); setDuracaoSeg(null); setMinutos('2')
      await aoSalvar()
      setMsg({ texto: 'Etapa incluída.', erro: false })
    } catch {
      setMsg({ texto: 'Não foi possível salvar a etapa. Confira os campos e tente de novo.', erro: true })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={salvar} style={{ display: 'grid', gap: 14 }} aria-label="Nova etapa">
      <h3>Incluir etapa</h3>
      <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        <label>Tipo
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoEtapa); setArquivo(null); setDuracaoSeg(null) }}>
            {(Object.keys(TIPOS_DE_ETAPA) as TipoEtapa[]).map((k) => <option key={k} value={k}>{TIPOS_DE_ETAPA[k]}</option>)}
          </select>
        </label>
        <label>Título da etapa
          <input required maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Como fazer a vistoria" />
        </label>
      </div>
      {tipo === 'youtube' && (
        <>
          <label>Link do vídeo no YouTube
            <input value={link} onChange={(e) => { setLink(e.target.value); setDuracaoSeg(null) }} placeholder="https://www.youtube.com/watch?v=…" />
            <small>Deixe o vídeo como “não listado” no YouTube: só quem tem o link consegue ver.</small>
          </label>
          {codigo && <PreviaYoutube codigo={codigo} aoLerDuracao={lerDuracao} />}
        </>
      )}
      {(tipo === 'video' || tipo === 'pdf') && (
        <label>{tipo === 'video' ? 'Arquivo do vídeo (MP4 ou WebM, até 50 MB)' : 'Arquivo PDF (até 50 MB)'}
          <input key={tipo} type="file" accept={tipo === 'video' ? 'video/mp4,video/webm' : 'application/pdf'} onChange={(e) => void escolher(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {tipo === 'texto' && (
        <label>Texto
          <textarea required rows={10} maxLength={50000} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
      )}
      <label style={{ maxWidth: 320 }}>Tempo mínimo na etapa (minutos)
        <input inputMode="decimal" required value={minutos} onChange={(e) => setMinutos(e.target.value)} />
        <small>
          {video
            ? (duracaoSeg ? `O vídeo tem ${duracao(duracaoSeg)}. A pessoa precisa assistir esse tempo, sem adiantar.` : 'Preenchido com a duração do vídeo assim que ele carregar.')
            : 'Tempo que a pessoa precisa ficar com a página à vista. Ela também precisa ir até o fim.'}
        </small>
      </label>
      <div className="acoes"><button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Incluir etapa'}</button></div>
      <Retorno m={msg} />
    </form>
  )
}

type AltRascunho = { texto: string; correta: boolean }
function NovaPergunta({ t, proxima, aoSalvar }: { t: Treinamento; proxima: number; aoSalvar: () => Promise<void> }) {
  const [tipo, setTipo] = useState<TipoPergunta>('unica')
  const [enunciado, setEnunciado] = useState('')
  const [peso, setPeso] = useState('1')
  const [alts, setAlts] = useState<AltRascunho[]>([{ texto: '', correta: true }, { texto: '', correta: false }])
  const [vfCerta, setVfCerta] = useState<'Verdadeiro' | 'Falso'>('Verdadeiro')
  const [msg, setMsg] = useState<Mensagem>(null)

  function marcar(i: number) {
    setAlts((a) => a.map((x, j) => (tipo === 'unica' ? { ...x, correta: j === i } : j === i ? { ...x, correta: !x.correta } : x)))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const lista = tipo === 'vf'
      ? [{ texto: 'Verdadeiro', correta: vfCerta === 'Verdadeiro' }, { texto: 'Falso', correta: vfCerta === 'Falso' }]
      : tipo === 'escrita' ? [] : alts.map((a) => ({ ...a, texto: a.texto.trim() })).filter((a) => a.texto)
    if (tipo === 'unica' || tipo === 'multipla') {
      if (lista.length < 2) return setMsg({ texto: 'Escreva pelo menos duas alternativas.', erro: true })
      const certas = lista.filter((a) => a.correta).length
      if (certas === 0) return setMsg({ texto: 'Marque a alternativa certa.', erro: true })
      if (tipo === 'unica' && certas > 1) return setMsg({ texto: 'Neste tipo, só uma alternativa é certa.', erro: true })
    }
    const { data, error } = await supabase.from('treinamento_perguntas')
      .insert({ treinamento_id: t.id, empresa_id: t.empresa_id, ordem: proxima, tipo, enunciado: enunciado.trim(), peso: Number(peso) })
      .select('id').single()
    if (error || !data) return setMsg({ texto: 'Não foi possível salvar a pergunta.', erro: true })
    if (lista.length) {
      const { error: e2 } = await supabase.from('treinamento_alternativas')
        .insert(lista.map((a, i) => ({ pergunta_id: data.id, empresa_id: t.empresa_id, ordem: i + 1, texto: a.texto, correta: a.correta })))
      if (e2) {
        await supabase.from('treinamento_perguntas').delete().eq('id', data.id)
        return setMsg({ texto: 'Não foi possível salvar as alternativas.', erro: true })
      }
    }
    setEnunciado(''); setPeso('1'); setAlts([{ texto: '', correta: true }, { texto: '', correta: false }])
    await aoSalvar()
    setMsg({ texto: 'Pergunta incluída.', erro: false })
  }

  return (
    <form onSubmit={salvar} style={{ display: 'grid', gap: 14 }} aria-label="Nova pergunta">
      <h3>Incluir pergunta</h3>
      <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        <label>Tipo
          <select value={tipo} onChange={(e) => {
            const novo = e.target.value as TipoPergunta
            setTipo(novo)
            if (novo === 'unica') setAlts((a) => a.map((x, i) => ({ ...x, correta: i === Math.max(0, a.findIndex((y) => y.correta)) })))
          }}>
            {(Object.keys(TIPOS_DE_PERGUNTA) as TipoPergunta[]).map((k) => <option key={k} value={k}>{TIPOS_DE_PERGUNTA[k]}</option>)}
          </select>
        </label>
        <label>Peso
          <select value={peso} onChange={(e) => setPeso(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <label>Pergunta
        <textarea required rows={2} maxLength={2000} value={enunciado} onChange={(e) => setEnunciado(e.target.value)} />
      </label>
      {(tipo === 'unica' || tipo === 'multipla') && (
        <fieldset>
          <legend>Alternativas ({tipo === 'unica' ? 'marque a certa' : 'marque todas as certas'})</legend>
          {alts.map((a, i) => (
            <div key={i} className="alternativa-linha">
              <input type={tipo === 'unica' ? 'radio' : 'checkbox'} name="certa" checked={a.correta} onChange={() => marcar(i)} aria-label={`Alternativa ${i + 1} é certa`} />
              <input value={a.texto} maxLength={500} onChange={(e) => setAlts((x) => x.map((y, j) => (j === i ? { ...y, texto: e.target.value } : y)))} aria-label={`Alternativa ${i + 1}`} />
              {alts.length > 2 && <button type="button" className="secundario" onClick={() => setAlts((x) => x.filter((_, j) => j !== i))} aria-label={`Remover alternativa ${i + 1}`}>Remover</button>}
            </div>
          ))}
          {alts.length < 6 && <div><button type="button" className="secundario" onClick={() => setAlts((x) => [...x, { texto: '', correta: false }])}>Mais uma alternativa</button></div>}
        </fieldset>
      )}
      {tipo === 'vf' && (
        <fieldset>
          <legend>A afirmação é</legend>
          <div className="opcoes-linha">
            {(['Verdadeiro', 'Falso'] as const).map((v) => (
              <label key={v}><input type="radio" name="vf" checked={vfCerta === v} onChange={() => setVfCerta(v)} />{v}</label>
            ))}
          </div>
        </fieldset>
      )}
      {tipo === 'escrita' && <p><small>A pessoa escreve a resposta e fica aguardando a sua correção para saber a nota.</small></p>}
      <div className="acoes"><button type="submit">Incluir pergunta</button></div>
      <Retorno m={msg} />
    </form>
  )
}

export default function TreinamentoEditor() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { podeGerir } = useEmpresa()
  const [t, setT] = useState<Treinamento | null>(null)
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  const [alternativas, setAlternativas] = useState<Alternativa[]>([])
  const [dados, setDados] = useState({ titulo: '', descricao: '', nota: '70', tentativas: '3', embaralhar: true })
  const [msg, setMsg] = useState<Mensagem>(null)
  const [msgDados, setMsgDados] = useState<Mensagem>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    const [a, b, c] = await Promise.all([
      supabase.from('treinamentos').select('*').eq('id', id).maybeSingle<Treinamento>(),
      supabase.from('treinamento_etapas').select('*').eq('treinamento_id', id).order('ordem').returns<Etapa[]>(),
      supabase.from('treinamento_perguntas').select('*').eq('treinamento_id', id).order('ordem').returns<Pergunta[]>(),
    ])
    const ps = c.data ?? []
    const alts = ps.length
      ? (await supabase.from('treinamento_alternativas').select('*').in('pergunta_id', ps.map((p) => p.id)).order('ordem').returns<Alternativa[]>()).data ?? []
      : []
    setT(a.data ?? null)
    if (a.data) setDados({ titulo: a.data.titulo, descricao: a.data.descricao ?? '', nota: String(a.data.nota_minima), tentativas: String(a.data.tentativas), embaralhar: a.data.embaralhar })
    setEtapas(b.data ?? [])
    setPerguntas(ps)
    setAlternativas(alts)
  }, [id])

  useEffect(() => { void carregar() }, [carregar])

  if (!podeGerir) return <main><p role="alert" className="erro">Só o administrador e o gestor de frota montam treinamentos.</p></main>
  if (!t) return <main><p>Carregando…</p></main>
  const rascunho = !t.publicado_em
  const tempoTotal = etapas.reduce((s, e) => s + e.tempo_minimo_seg, 0)

  async function salvarDados(e: FormEvent) {
    e.preventDefault()
    setMsgDados(null)
    const { error } = await supabase.from('treinamentos').update({
      titulo: dados.titulo.trim(), descricao: dados.descricao.trim() || null, nota_minima: Number(dados.nota),
      tentativas: Number(dados.tentativas), embaralhar: dados.embaralhar,
    }).eq('id', t!.id)
    setMsgDados(error ? { texto: 'Não foi possível salvar. A nota vai de 0 a 100 e as tentativas de 1 a 10.', erro: true } : { texto: 'Salvo.', erro: false })
    if (!error) await carregar()
  }

  async function mover(i: number, para: number) {
    const a = etapas[i], b = etapas[para]
    if (!a || !b) return
    // troca as posições passando por um valor temporário
    await supabase.from('treinamento_etapas').update({ ordem: -1 }).eq('id', a.id)
    await supabase.from('treinamento_etapas').update({ ordem: a.ordem }).eq('id', b.id)
    await supabase.from('treinamento_etapas').update({ ordem: b.ordem }).eq('id', a.id)
    await carregar()
  }

  async function removerEtapa(e: Etapa) {
    if (!window.confirm(`Remover a etapa “${e.titulo}”?`)) return
    await supabase.from('treinamento_etapas').delete().eq('id', e.id)
    // o arquivo só é apagado se nenhuma outra versão usar
    await carregar()
  }

  async function removerPergunta(p: Pergunta) {
    if (!window.confirm('Remover esta pergunta?')) return
    await supabase.from('treinamento_perguntas').delete().eq('id', p.id)
    await carregar()
  }

  async function publicar() {
    setMsg(null)
    if (!window.confirm(`Publicar “${t!.titulo}”? Depois de publicado, o conteúdo e a prova não mudam: para alterar, crie uma nova versão.`)) return
    const { error } = await supabase.rpc('publicar_treinamento', { p_treinamento: t!.id })
    if (error) return setMsg({ texto: mensagemDeErro(error), erro: true })
    await carregar()
    setMsg({ texto: 'Treinamento publicado.', erro: false })
  }

  async function novaVersao() {
    setMsg(null)
    const { data, error } = await supabase.rpc('nova_versao_treinamento', { p_treinamento: t!.id })
    if (error) return setMsg({ texto: mensagemDeErro(error), erro: true })
    navegar(`/treinamentos/${data as string}`)
  }

  async function alternarAtivo() {
    await supabase.from('treinamentos').update({ ativo: !t!.ativo }).eq('id', t!.id)
    await carregar()
  }

  async function apagarRascunho() {
    if (!window.confirm('Apagar este rascunho?')) return
    await supabase.from('treinamentos').delete().eq('id', t!.id)
    navegar('/treinamentos')
  }

  return (
    <main>
      <p><Link to="/treinamentos">← Treinamentos</Link></p>
      <h1>{t.titulo} <small className="versao">versão {t.versao}</small></h1>
      <p>
        {rascunho ? <span className="situacao s-solicitada">Rascunho</span> : <span className={`situacao ${t.ativo ? 's-aprovada' : ''}`}>{t.ativo ? 'Publicado' : 'Fora do ar'}</span>}
        {' '}<span className="situacao">{BLOQUEIOS[t.bloqueio].rotulo}</span>
        {' '}{etapas.length} {etapas.length === 1 ? 'etapa' : 'etapas'}, cerca de {duracao(tempoTotal)} de conteúdo, {perguntas.length} {perguntas.length === 1 ? 'pergunta' : 'perguntas'}.
      </p>
      <Retorno m={msg} />
      {!rascunho && (
        <section className="cartao">
          <p>Publicado: o conteúdo e a prova não mudam mais, para não alterar o registro de quem já fez. Para corrigir ou acrescentar algo, crie uma nova versão; ao publicá-la, esta sai do ar.</p>
          <div className="acoes">
            <button type="button" onClick={novaVersao}>Criar nova versão</button>
            <button type="button" className="secundario" onClick={alternarAtivo}>{t.ativo ? 'Tirar do ar' : 'Pôr no ar de novo'}</button>
          </div>
        </section>
      )}

      {!rascunho && <AcompanhamentoTreinamento t={t} />}
      <RegrasTreinamento key={t.id} t={t} aoSalvar={carregar} />

      <section className="cartao" aria-label="Dados do treinamento">
        <h2>Dados e regras da prova</h2>
        <form onSubmit={salvarDados} style={{ display: 'grid', gap: 14 }}>
          <fieldset disabled={!rascunho} style={{ border: 0, padding: 0 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <label>Título
                <input required maxLength={120} value={dados.titulo} onChange={(e) => setDados({ ...dados, titulo: e.target.value })} />
              </label>
              <label>Descrição (opcional)
                <textarea rows={2} maxLength={2000} value={dados.descricao} onChange={(e) => setDados({ ...dados, descricao: e.target.value })} />
              </label>
              <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                <label>Nota mínima para aprovar (0 a 100)
                  <input type="number" min={0} max={100} required value={dados.nota} onChange={(e) => setDados({ ...dados, nota: e.target.value })} />
                </label>
                <label>Tentativas da prova
                  <input type="number" min={1} max={10} required value={dados.tentativas} onChange={(e) => setDados({ ...dados, tentativas: e.target.value })} />
                  <small>Acabando as tentativas, a pessoa refaz o conteúdo antes de tentar de novo.</small>
                </label>
              </div>
              <label className="linha"><input type="checkbox" checked={dados.embaralhar} onChange={(e) => setDados({ ...dados, embaralhar: e.target.checked })} />Embaralhar perguntas e alternativas a cada tentativa</label>
            </div>
          </fieldset>
          {rascunho && <div className="acoes"><button type="submit">Salvar</button></div>}
          <Retorno m={msgDados} />
        </form>
      </section>

      <section className="cartao" aria-label="Etapas">
        <h2>Conteúdo</h2>
        <p>As etapas são feitas nesta ordem. Cada uma só libera a próxima depois do tempo mínimo.</p>
        {etapas.length === 0 && <p>Nenhuma etapa ainda.</p>}
        <ol className="lista-etapas">
          {etapas.map((e, i) => (
            <li key={e.id}>
              <div>
                <strong>{e.titulo}</strong>
                <small>{TIPOS_DE_ETAPA[e.tipo]} · mínimo {duracao(e.tempo_minimo_seg)}{e.duracao_seg ? ` · vídeo de ${duracao(e.duracao_seg)}` : ''}</small>
              </div>
              {rascunho && (
                <div className="acoes">
                  <button type="button" className="secundario" disabled={i === 0} onClick={() => mover(i, i - 1)} aria-label={`Subir ${e.titulo}`}>Subir</button>
                  <button type="button" className="secundario" disabled={i === etapas.length - 1} onClick={() => mover(i, i + 1)} aria-label={`Descer ${e.titulo}`}>Descer</button>
                  <button type="button" className="perigo" onClick={() => removerEtapa(e)} aria-label={`Remover ${e.titulo}`}>Remover</button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {rascunho && <NovaEtapa t={t} proxima={Math.max(0, ...etapas.map((e) => e.ordem)) + 1} aoSalvar={carregar} />}
      </section>

      <section className="cartao" aria-label="Prova">
        <h2>Prova</h2>
        <p>Nota mínima {t.nota_minima}, {t.tentativas} {t.tentativas === 1 ? 'tentativa' : 'tentativas'}. Na pergunta com várias certas, só vale ponto quem marcar todas as certas e nenhuma errada.</p>
        {perguntas.length === 0 && <p>Nenhuma pergunta ainda.</p>}
        <ol className="lista-perguntas">
          {perguntas.map((p) => (
            <li key={p.id}>
              <div className="doc-topo">
                <strong>{p.enunciado}</strong>
                {rascunho && <button type="button" className="perigo" onClick={() => removerPergunta(p)}>Remover</button>}
              </div>
              <small>{TIPOS_DE_PERGUNTA[p.tipo]} · peso {p.peso}</small>
              {p.tipo !== 'escrita' && (
                <ul>
                  {alternativas.filter((a) => a.pergunta_id === p.id).map((a) => (
                    <li key={a.id}>{a.correta ? <strong>✓ {a.texto} (certa)</strong> : a.texto}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        {rascunho && <NovaPergunta t={t} proxima={Math.max(0, ...perguntas.map((p) => p.ordem)) + 1} aoSalvar={carregar} />}
      </section>

      {rascunho && (
        <section className="cartao" aria-label="Publicar">
          <h2>Publicar</h2>
          <p>Antes de publicar, confira o conteúdo e a prova. O sistema confere se toda pergunta tem resposta certa.</p>
          <div className="acoes">
            <button type="button" onClick={publicar}>Publicar treinamento</button>
            <button type="button" className="perigo" onClick={apagarRascunho}>Apagar rascunho</button>
          </div>
        </section>
      )}
    </main>
  )
}
