import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { colunasDoResultado } from '../components/AcompanhamentoTreinamento'
import { baixarCsv, gerarCsv } from '../lib/csv'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'
import { BLOQUEIOS } from '../lib/treinamentos'
import type { LinhaAcompanhamento, PerguntaDaProva, Treinamento } from '../lib/treinamentos'

type ParaCorrigir = {
  id: string; treinamento_id: string; user_id: string; numero: number; enviada_em: string
  perguntas: PerguntaDaProva[]; respostas: Record<string, string | string[]>
}
type Mensagem = { texto: string; erro: boolean } | null

const NOTAS = [{ valor: 1, rotulo: 'Certa' }, { valor: 0.5, rotulo: 'Meio certa' }, { valor: 0, rotulo: 'Errada' }]

function Correcao({ x, titulo, pessoa, aoCorrigir }: { x: ParaCorrigir; titulo: string; pessoa: string; aoCorrigir: () => Promise<void> }) {
  const escritas = x.perguntas.filter((p) => p.tipo === 'escrita')
  const [pontos, setPontos] = useState<Record<string, number>>({})
  const [comentario, setComentario] = useState('')
  const [msg, setMsg] = useState<Mensagem>(null)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (escritas.some((p) => pontos[p.id] === undefined)) return setMsg({ texto: 'Avalie todas as respostas escritas.', erro: true })
    const { error } = await supabase.rpc('corrigir_prova', { p_tentativa: x.id, p_pontos: pontos, p_comentario: comentario })
    if (error) return setMsg({ texto: mensagemDeErro(error), erro: true })
    await aoCorrigir()
  }

  return (
    <form className="doc-linha" onSubmit={enviar}>
      <div className="doc-topo"><strong>{pessoa}: {titulo}</strong><small>Tentativa {x.numero}, enviada {formatarDataHora(x.enviada_em)}</small></div>
      {escritas.map((p) => (
        <fieldset key={p.id}>
          <legend>{p.enunciado}</legend>
          <p className="resposta-escrita">{typeof x.respostas?.[p.id] === 'string' && x.respostas[p.id] ? x.respostas[p.id] : <em>Sem resposta</em>}</p>
          <div className="opcoes-linha">
            {NOTAS.map((n) => (
              <label key={n.valor}><input type="radio" name={`${x.id}-${p.id}`} checked={pontos[p.id] === n.valor} onChange={() => setPontos({ ...pontos, [p.id]: n.valor })} />{n.rotulo}</label>
            ))}
          </div>
        </fieldset>
      ))}
      <label>Comentário para a pessoa (opcional)
        <input value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </label>
      <div className="acoes"><button type="submit">Concluir correção</button></div>
      {msg && <p role="alert" className="erro">{msg.texto}</p>}
    </form>
  )
}

export default function Treinamentos() {
  const { session } = useAuth()
  const navegar = useNavigate()
  const { empresaId, podeGerir } = useEmpresa()
  const [lista, setLista] = useState<Treinamento[]>([])
  const [corrigir, setCorrigir] = useState<ParaCorrigir[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [titulo, setTitulo] = useState('')
  const [msg, setMsg] = useState<Mensagem>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const [t, c, m] = await Promise.all([
      supabase.from('treinamentos').select('*').eq('empresa_id', empresaId).order('titulo').order('versao', { ascending: false }).returns<Treinamento[]>(),
      supabase.from('treinamento_tentativas').select('id, treinamento_id, user_id, numero, enviada_em, perguntas, respostas')
        .eq('empresa_id', empresaId).eq('status', 'aguardando_correcao').order('enviada_em').returns<ParaCorrigir[]>(),
      supabase.from('membros').select('user_id, nome').eq('empresa_id', empresaId).returns<{ user_id: string; nome: string | null }[]>(),
    ])
    setLista(t.data ?? [])
    setCorrigir(c.data ?? [])
    setNomes(Object.fromEntries((m.data ?? []).map((x) => [x.user_id, x.nome ?? 'Sem nome'])))
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  async function criar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const { data, error } = await supabase.from('treinamentos')
      .insert({ empresa_id: empresaId, titulo: titulo.trim(), criado_por: session?.user.id }).select('id').single()
    if (error || !data) return setMsg({ texto: 'Não foi possível criar o treinamento.', erro: true })
    navegar(`/treinamentos/${data.id}`)
  }

  async function planilhaGeral() {
    setMsg(null)
    const noAr = lista.filter((t) => t.publicado_em && t.ativo)
    const linhas: string[] = []
    for (const t of noAr) {
      const { data } = await supabase.rpc('acompanhamento_treinamento', { p_treinamento: t.id })
      const csv = gerarCsv((data as LinhaAcompanhamento[]) ?? [], colunasDoResultado(t.titulo)).replace(/^\uFEFF/, '').trimEnd().split('\r\n')
      linhas.push(...(linhas.length ? csv.slice(1) : csv))
    }
    if (!linhas.length) return setMsg({ texto: 'Nenhum treinamento publicado ainda.', erro: true })
    baixarCsv(`treinamentos-resultados-${new Date().toISOString().slice(0, 10)}.csv`, '\uFEFF' + linhas.join('\r\n') + '\r\n')
  }

  if (!podeGerir) return <main><p role="alert" className="erro">Só o administrador e o gestor de frota montam treinamentos.</p></main>

  // Uma linha por treinamento (família), com as versões embaixo
  const familias = [...new Set(lista.map((t) => t.familia_id))].map((f) => lista.filter((t) => t.familia_id === f))
  const tituloDe = (id: string) => lista.find((t) => t.id === id)?.titulo ?? 'Treinamento'

  return (
    <main>
      <h1>Treinamentos</h1>
      <p>Monte o conteúdo (vídeos, textos e PDFs) e a prova. A pessoa só avança de etapa depois do tempo mínimo e só faz a prova no fim.</p>

      {corrigir.length > 0 && (
        <section className="cartao" aria-label="Provas para corrigir">
          <h2>Provas para corrigir <span className="contador urgente">{corrigir.length}</span></h2>
          <p>A pessoa só recebe a nota depois da sua correção.</p>
          {corrigir.map((x) => <Correcao key={x.id} x={x} titulo={tituloDe(x.treinamento_id)} pessoa={nomes[x.user_id] ?? 'Pessoa'} aoCorrigir={carregar} />)}
        </section>
      )}

      <section className="cartao" aria-label="Treinamentos">
        <div className="doc-topo"><h2>Seus treinamentos</h2>
          {familias.length > 0 && <button type="button" className="secundario" onClick={planilhaGeral}>Baixar todos os resultados (CSV)</button>}
        </div>
        {familias.length === 0 && <p>Nenhum treinamento ainda. Comece criando um abaixo, por exemplo “Onboarding” ou “Reciclagem anual”.</p>}
        {familias.map((versoes) => {
          const atual = versoes[0]
          return (
            <div key={atual.familia_id} className="doc-linha">
              <div className="doc-topo">
                <strong>{atual.titulo}</strong>
                <span>
                  {versoes.map((v) => (
                    <Link key={v.id} className="botao secundario-link pequeno" to={`/treinamentos/${v.id}`} style={{ marginLeft: 6 }}>
                      Versão {v.versao}: {!v.publicado_em ? 'rascunho' : v.ativo ? 'no ar' : 'fora do ar'}
                    </Link>
                  ))}
                </span>
              </div>
              <small>{BLOQUEIOS[(versoes.find((v) => v.publicado_em && v.ativo) ?? atual).bloqueio].rotulo}</small>
              {atual.descricao && <small>{atual.descricao}</small>}
            </div>
          )
        })}
      </section>

      <section className="cartao" aria-label="Novo treinamento">
        <h2>Novo treinamento</h2>
        <form onSubmit={criar} className="acoes">
          <label style={{ flex: 1, minWidth: 220 }}>Título
            <input required maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Onboarding de motoristas" />
          </label>
          <button type="submit">Criar e montar</button>
        </form>
        {msg && <p role="alert" className="erro">{msg.texto}</p>}
      </section>
    </main>
  )
}
