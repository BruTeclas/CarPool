import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { CorpoDoComunicado } from '../components/Comunicado'
import { NIVEIS, prepararImagem, RECORRENCIAS } from '../lib/comunicados'
import type { ComunicadoGestor, Nivel, Recorrencia } from '../lib/comunicados'
import { baixarCsv, gerarCsv } from '../lib/csv'
import { formatarDataHora, paraCampo, paraInstante } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { PERFIS } from '../lib/perfis'
import { supabase } from '../lib/supabase'

type Mensagem = { texto: string; erro: boolean } | null
type Opcao = { id: string; nome: string }
type Linha = { user_id: string; nome: string | null; visto_em: string | null; ciente_em: string | null; ocorrencia: string }

const vazio = () => ({
  titulo: '', texto: '', acaoRotulo: '', acaoLink: '', perfis: [] as string[], grupos: [] as string[], unidade: '',
  nivel: 'informativo' as Nivel, recorrencia: 'unica' as Recorrencia, inicio: paraCampo(new Date()), fim: '', janela: '31',
})

function situacao(c: ComunicadoGestor): string {
  const agora = Date.now()
  if (c.encerrado_em) return 'Encerrado'
  if (new Date(c.inicio).getTime() > agora) return 'Agendado'
  if (c.fim && new Date(c.fim).getTime() <= agora) return 'Terminado'
  return 'No ar'
}

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export default function Comunicados() {
  const { session } = useAuth()
  const { empresaId, perfis, podeOperar } = useEmpresa()
  const toda = perfis.includes('admin') || perfis.includes('gestor_frota')
  const [f, setF] = useState(vazio)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previaImagem, setPreviaImagem] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<Mensagem>(null)
  const [lista, setLista] = useState<ComunicadoGestor[]>([])
  const [grupos, setGrupos] = useState<Opcao[]>([])
  const [filiais, setFiliais] = useState<Opcao[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [msgAcomp, setMsgAcomp] = useState<Mensagem>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const [c, g, u] = await Promise.all([
      supabase.from('comunicados').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).returns<ComunicadoGestor[]>(),
      supabase.from('grupos').select('id, nome').eq('empresa_id', empresaId).order('nome').returns<Opcao[]>(),
      supabase.from('unidades').select('id, nome').eq('empresa_id', empresaId).order('nome').returns<Opcao[]>(),
    ])
    setLista(c.data ?? [])
    setGrupos(g.data ?? [])
    setFiliais(u.data ?? [])
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])
  // Gestor de base só envia para a própria filial: já deixa a primeira escolhida
  useEffect(() => {
    if (!toda && filiais.length && !f.unidade) setF((x) => ({ ...x, unidade: filiais[0].id }))
  }, [toda, filiais, f.unidade])

  useEffect(() => {
    if (!arquivo) { setPreviaImagem(null); return }
    const url = URL.createObjectURL(arquivo)
    setPreviaImagem(url)
    return () => URL.revokeObjectURL(url)
  }, [arquivo])

  const muda = <K extends keyof ReturnType<typeof vazio>>(k: K, v: ReturnType<typeof vazio>[K]) => setF((x) => ({ ...x, [k]: v }))
  const alterna = (k: 'perfis' | 'grupos', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }))

  const publico = useMemo(() => {
    const partes = [
      f.perfis.length ? PERFIS.filter((p) => f.perfis.includes(p.valor)).map((p) => p.rotulo.toLowerCase()).join(', ') : 'todas as pessoas',
      f.grupos.length ? `do grupo ${grupos.filter((g) => f.grupos.includes(g.id)).map((g) => g.nome).join(' ou ')}` : '',
      f.unidade ? `da filial ${filiais.find((u) => u.id === f.unidade)?.nome ?? ''}` : 'de todas as filiais',
    ]
    return partes.filter(Boolean).join(' ')
  }, [f.perfis, f.grupos, f.unidade, grupos, filiais])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!f.texto.trim() && !arquivo) return setMsg({ texto: 'Escreva um texto ou escolha uma imagem.', erro: true })
    if ((f.acaoRotulo.trim() === '') !== (f.acaoLink.trim() === '')) return setMsg({ texto: 'Para o botão de ação, preencha o nome e o link.', erro: true })
    if (!window.confirm(`Enviar “${f.titulo.trim()}” para ${publico}?\nDepois de enviado, o comunicado não pode ser alterado, só encerrado.`)) return
    setEnviando(true)
    let caminho: string | null = null
    if (arquivo) {
      try {
        const imagem = await prepararImagem(arquivo)
        caminho = `${empresaId}/${crypto.randomUUID()}.webp`
        const { error } = await supabase.storage.from('comunicados').upload(caminho, imagem, { contentType: 'image/webp' })
        if (error) throw error
      } catch {
        setEnviando(false)
        return setMsg({ texto: 'Não foi possível enviar a imagem. Use JPG, PNG ou WebP.', erro: true })
      }
    }
    const { error } = await supabase.from('comunicados').insert({
      empresa_id: empresaId, titulo: f.titulo.trim(), texto: f.texto.trim() || null, imagem_caminho: caminho,
      acao_rotulo: f.acaoRotulo.trim() || null, acao_link: f.acaoLink.trim() || null,
      publico_perfis: f.perfis.length ? f.perfis : null, publico_grupos: f.grupos.length ? f.grupos : null, unidade_id: f.unidade || null,
      nivel: f.nivel, recorrencia: f.recorrencia, inicio: paraInstante(f.inicio), fim: f.fim ? paraInstante(f.fim) : null,
      janela_dias: f.recorrencia === 'anual' ? Number(f.janela) : null, criado_por: session?.user.id,
    })
    setEnviando(false)
    if (error) {
      if (caminho) await supabase.storage.from('comunicados').remove([caminho])
      return setMsg({ texto: error.message.includes('check') ? 'Confira os campos: a data de fim precisa ser depois do início e o link precisa começar com https://.' : mensagemDeErro(error), erro: true })
    }
    setF(vazio())
    setArquivo(null)
    await carregar()
    setMsg({ texto: 'Comunicado enviado. Ele aparece para cada pessoa na próxima vez que abrir o app.', erro: false })
  }

  async function acompanhar(id: string) {
    setMsgAcomp(null)
    if (aberto === id) { setAberto(null); return }
    setAberto(id)
    setLinhas(null)
    const { data, error } = await supabase.rpc('acompanhamento_comunicado', { p_comunicado: id })
    if (error) return setMsgAcomp({ texto: mensagemDeErro(error), erro: true })
    setLinhas((data as Linha[]) ?? [])
  }

  async function encerrar(c: ComunicadoGestor) {
    if (!window.confirm(`Encerrar “${c.titulo}”? Ele deixa de aparecer para todos.`)) return
    const { error } = await supabase.from('comunicados').update({ encerrado_em: new Date().toISOString(), encerrado_por: session?.user.id }).eq('id', c.id)
    if (error) return setMsgAcomp({ texto: mensagemDeErro(error), erro: true })
    await carregar()
  }

  function planilha(c: ComunicadoGestor) {
    if (!linhas) return
    baixarCsv(`comunicado-${c.titulo.slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`, gerarCsv(linhas, [
      { titulo: 'Pessoa', valor: (l) => l.nome },
      { titulo: 'Repetição de', valor: (l) => dataBr(l.ocorrencia) },
      { titulo: 'Viu em', valor: (l) => (l.visto_em ? formatarDataHora(l.visto_em) : '') },
      { titulo: 'Confirmou em', valor: (l) => (l.ciente_em ? formatarDataHora(l.ciente_em) : '') },
    ]))
  }

  if (!podeOperar) return <main><p role="alert" className="erro">Você não tem acesso aos comunicados.</p></main>

  return (
    <main>
      <h1>Comunicados</h1>
      <p>Avisos para os colaboradores: aparecem em tela cheia quando a pessoa abre o app e ficam guardados em Avisos.{!toda && ' Como gestor de base, você envia para as pessoas da sua filial.'}</p>

      <section className="cartao" aria-label="Novo comunicado">
        <h2>Novo comunicado</h2>
        <form onSubmit={enviar} style={{ display: 'grid', gap: 16 }}>
          <label>Título
            <input required maxLength={120} value={f.titulo} onChange={(e) => muda('titulo', e.target.value)} placeholder="Ex.: Maio Amarelo: atenção no trânsito" />
          </label>
          <label>Texto
            <textarea rows={5} maxLength={5000} value={f.texto} onChange={(e) => muda('texto', e.target.value)} />
          </label>
          <label>Imagem (opcional)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <small>JPG, PNG ou WebP. É reduzida automaticamente para abrir rápido no celular.</small>
          </label>
          <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <label>Botão de ação (opcional)
              <input maxLength={40} value={f.acaoRotulo} onChange={(e) => muda('acaoRotulo', e.target.value)} placeholder="Ex.: Saiba mais" />
            </label>
            <label>Link do botão
              <input value={f.acaoLink} onChange={(e) => muda('acaoLink', e.target.value)} placeholder="https://… ou /reservar" />
            </label>
          </div>

          <fieldset>
            <legend>Para quem</legend>
            <p><small>Sem marcar nada, vai para todos. As escolhas se somam: “motoristas” + “filial X” = motoristas da filial X.</small></p>
            <p className="nav-titulo" style={{ padding: 0 }}>Perfis</p>
            <div className="opcoes-linha">
              {PERFIS.map((p) => (
                <label key={p.valor}><input type="checkbox" checked={f.perfis.includes(p.valor)} onChange={() => alterna('perfis', p.valor)} />{p.rotulo}</label>
              ))}
            </div>
            {grupos.length > 0 && (
              <>
                <p className="nav-titulo" style={{ padding: '12px 0 0' }}>Grupos</p>
                <div className="opcoes-linha">
                  {grupos.map((g) => (
                    <label key={g.id}><input type="checkbox" checked={f.grupos.includes(g.id)} onChange={() => alterna('grupos', g.id)} />{g.nome}</label>
                  ))}
                </div>
              </>
            )}
            <label style={{ marginTop: 12, maxWidth: 360 }}>Filial
              <select value={f.unidade} onChange={(e) => muda('unidade', e.target.value)} required={!toda}>
                {toda && <option value="">Todas as filiais</option>}
                {filiais.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Importância</legend>
            {(Object.keys(NIVEIS) as Nivel[]).map((n) => (
              <label key={n} className="linha">
                <input type="radio" name="nivel" checked={f.nivel === n}
                  onChange={() => setF((x) => ({ ...x, nivel: n, recorrencia: n === 'informativo' && x.recorrencia === 'ate_confirmar' ? 'unica' : x.recorrencia }))} />
                <span><strong>{NIVEIS[n].rotulo}.</strong> {NIVEIS[n].ajuda}</span>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Quando</legend>
            <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              <label>Repetição
                <select value={f.recorrencia} onChange={(e) => muda('recorrencia', e.target.value as Recorrencia)}>
                  {(Object.keys(RECORRENCIAS) as Recorrencia[]).filter((r) => r !== 'ate_confirmar' || f.nivel !== 'informativo')
                    .map((r) => <option key={r} value={r}>{RECORRENCIAS[r]}</option>)}
                </select>
              </label>
              <label>Começa em
                <input type="datetime-local" required value={f.inicio} onChange={(e) => muda('inicio', e.target.value)} />
              </label>
              <label>Termina em (opcional)
                <input type="datetime-local" value={f.fim} onChange={(e) => muda('fim', e.target.value)} />
              </label>
              {f.recorrencia === 'anual' && (
                <label>Fica no ar por (dias, a cada ano)
                  <input type="number" min={1} max={366} required value={f.janela} onChange={(e) => muda('janela', e.target.value)} />
                </label>
              )}
            </div>
            <p><small>
              {f.recorrencia === 'unica' && 'Aparece uma vez para cada pessoa.'}
              {f.recorrencia === 'diaria' && 'Aparece de novo todo dia, até a data de fim.'}
              {f.recorrencia === 'semanal' && 'Aparece de novo a cada 7 dias, contando do início.'}
              {f.recorrencia === 'mensal' && 'Aparece de novo todo mês, no mesmo dia do início.'}
              {f.recorrencia === 'anual' && 'Aparece todo ano a partir da data de início e fica no ar pelos dias informados. Bom para campanhas como o Maio Amarelo.'}
              {f.recorrencia === 'ate_confirmar' && 'Aparece toda vez que a pessoa abre o app, até ela clicar em “Li e entendi”.'}
            </small></p>
          </fieldset>

          <div className="previa" aria-label="Prévia">
            <p className="popup-rotulo">Prévia do que a pessoa vai ver</p>
            <h2>{f.titulo || 'Título do comunicado'}</h2>
            <CorpoDoComunicado c={{ titulo: f.titulo, texto: f.texto || null, imagem_caminho: null, acao_rotulo: f.acaoRotulo || null, acao_link: f.acaoLink || null }} imagemLocal={previaImagem} />
          </div>

          <div className="acoes"><button type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar comunicado'}</button></div>
          {msg && <p role={msg.erro ? 'alert' : 'status'} className={msg.erro ? 'erro' : 'sucesso'}>{msg.texto}</p>}
        </form>
      </section>

      <section className="cartao" aria-label="Comunicados enviados">
        <h2>Enviados</h2>
        {lista.length === 0 && <p>Nenhum comunicado enviado ainda.</p>}
        {lista.map((c) => {
          const s = situacao(c)
          const vistos = linhas?.filter((l) => l.visto_em).length ?? 0
          const cientes = linhas?.filter((l) => l.ciente_em).length ?? 0
          return (
            <div key={c.id} className="doc-linha">
              <div className="doc-topo">
                <strong>{c.titulo}</strong>
                <span className="situacao">{s}</span>
              </div>
              <small>{NIVEIS[c.nivel].rotulo} · {RECORRENCIAS[c.recorrencia]} · desde {formatarDataHora(c.inicio)}{c.fim ? ` até ${formatarDataHora(c.fim)}` : ''}</small>
              <div className="acoes">
                <button type="button" className="secundario" aria-expanded={aberto === c.id} onClick={() => acompanhar(c.id)}>
                  {aberto === c.id ? 'Fechar acompanhamento' : 'Acompanhar'}
                </button>
                {s !== 'Encerrado' && s !== 'Terminado' && <button type="button" className="perigo" onClick={() => encerrar(c)}>Encerrar</button>}
              </div>
              {aberto === c.id && (
                <div>
                  {msgAcomp && <p role="alert" className="erro">{msgAcomp.texto}</p>}
                  {linhas === null && !msgAcomp && <p>Carregando…</p>}
                  {linhas && (
                    <>
                      <p>
                        Repetição de {linhas[0] ? dataBr(linhas[0].ocorrencia) : '—'}: {linhas.length} {linhas.length === 1 ? 'pessoa' : 'pessoas'} no público, {vistos} {vistos === 1 ? 'viu' : 'viram'}
                        {c.nivel !== 'informativo' && `, ${cientes} ${cientes === 1 ? 'confirmou' : 'confirmaram'} a leitura`}.
                      </p>
                      <div className="tabela-rolagem">
                        <table>
                          <thead><tr><th>Pessoa</th><th>Viu em</th>{c.nivel !== 'informativo' && <th>Confirmou em</th>}</tr></thead>
                          <tbody>
                            {linhas.length === 0 && <tr><td colSpan={3} className="vazio">Ninguém no público deste comunicado.</td></tr>}
                            {linhas.map((l) => (
                              <tr key={l.user_id}>
                                <td>{l.nome ?? 'Sem nome'}</td>
                                <td>{l.visto_em ? formatarDataHora(l.visto_em) : 'Ainda não'}</td>
                                {c.nivel !== 'informativo' && <td>{l.ciente_em ? formatarDataHora(l.ciente_em) : 'Ainda não'}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="acoes"><button type="button" className="secundario" onClick={() => planilha(c)}>Baixar planilha (CSV)</button></div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </main>
  )
}
