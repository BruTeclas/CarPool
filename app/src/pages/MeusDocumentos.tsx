import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { abrirArquivo, baixarTermoAssinado, dataBr, subirArquivo } from '../lib/documentos'
import type { Assinatura, Documento, Termo, TipoDocumento } from '../lib/documentos'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'

const CATEGORIAS = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE']
type Aviso = { documento_id: string; tipo: string; validade: string; dias: number }

function situacao(d: Documento | undefined): { classe: string; texto: string } {
  if (!d) return { classe: 's-doc-faltando', texto: 'Não enviado' }
  if (d.status === 'pendente') return { classe: 's-doc-pendente', texto: 'Aguardando conferência' }
  if (d.status === 'recusado') return { classe: 's-doc-recusado', texto: 'Recusado' }
  if (d.validade && d.validade < new Date().toISOString().slice(0, 10)) return { classe: 's-doc-vencido', texto: `Vencido em ${dataBr(d.validade)}` }
  return { classe: 's-doc-aprovado', texto: d.validade ? `Válido até ${dataBr(d.validade)}` : 'Aprovado' }
}

export default function MeusDocumentos() {
  const { session } = useAuth()
  const { empresaId, empresaNome } = useEmpresa()
  const uid = session?.user.id ?? ''
  const [tipos, setTipos] = useState<TipoDocumento[]>([])
  const [docs, setDocs] = useState<Documento[]>([])
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [assinados, setAssinados] = useState<{ a: Assinatura; t: Termo }[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const [form, setForm] = useState({ validade: '', numero: '', categoria: '' })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId || !uid) return
    const [t, d, v, a] = await Promise.all([
      supabase.from('tipos_de_documento').select('*').eq('empresa_id', empresaId).eq('alvo', 'condutor').eq('ativo', true).order('nome').returns<TipoDocumento[]>(),
      supabase.from('documentos').select('*').eq('user_id', uid).eq('empresa_id', empresaId).order('enviado_em', { ascending: false }).returns<Documento[]>(),
      supabase.rpc('documentos_vencendo', { p_empresa: empresaId, p_so_meus: true }),
      supabase.from('assinaturas_de_termo').select('*, termos(*)').eq('user_id', uid).eq('empresa_id', empresaId)
        .order('assinado_em', { ascending: false }).returns<(Assinatura & { termos: Termo })[]>(),
    ])
    setTipos(t.data ?? [])
    setDocs(d.data ?? [])
    setAvisos((v.data as Aviso[]) ?? [])
    setAssinados((a.data ?? []).map((x) => ({ a: x, t: x.termos })))
  }, [empresaId, uid])

  useEffect(() => { void carregar() }, [carregar])

  function abrir(tipoId: string) {
    setAberto(tipoId)
    setForm({ validade: '', numero: '', categoria: '' })
    setArquivo(null)
    setMensagem(null)
  }

  async function enviar(e: FormEvent, tipo: TipoDocumento) {
    e.preventDefault()
    if (!arquivo || !empresaId) return
    setEnviando(true)
    setMensagem(null)
    try {
      const caminho = await subirArquivo(empresaId, uid, arquivo, arquivo.name)
      const { error } = await supabase.rpc('enviar_documento', {
        p_tipo: tipo.id, p_caminho: caminho, p_nome_arquivo: arquivo.name,
        p_validade: tipo.tem_validade ? form.validade : null,
        p_numero: form.numero || null, p_categoria_cnh: tipo.e_cnh ? form.categoria : null,
      })
      if (error) setMensagem({ texto: mensagemDeErro(error), erro: true })
      else { setMensagem({ texto: `${tipo.nome} enviado. O gestor da frota vai conferir.`, erro: false }); setAberto(null) }
    } catch {
      setMensagem({ texto: 'Não foi possível enviar o arquivo. Use foto ou PDF de até 10 MB.', erro: true })
    }
    setEnviando(false)
    await carregar()
  }

  return (
    <main>
      <h1>Meus documentos</h1>
      {avisos.map((v) => (
        <p key={v.documento_id} className="aviso" role="status">
          {v.dias < 0 ? `${v.tipo} venceu em ${dataBr(v.validade)}.` : v.dias === 0 ? `${v.tipo} vence hoje.` : `${v.tipo} vence em ${v.dias} dia${v.dias === 1 ? '' : 's'} (${dataBr(v.validade)}).`} Envie o documento renovado para continuar reservando.
        </p>
      ))}
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
      <section className="cartao" aria-label="Documentos">
        {tipos.length === 0 && <p>Nenhum documento é exigido no momento.</p>}
        {tipos.map((t) => {
          const atual = docs.find((d) => d.tipo_id === t.id)
          const s = situacao(atual)
          return (
            <div key={t.id} className="doc-linha">
              <div className="doc-topo">
                <strong>{t.nome}{t.obrigatorio ? '' : ' (opcional)'}</strong>
                <span className={`situacao ${s.classe}`}>{s.texto}</span>
              </div>
              {atual?.status === 'recusado' && <p className="erro" style={{ margin: 0 }}>Motivo da recusa: {atual.motivo_recusa}</p>}
              <div className="acoes">
                {atual && <button type="button" className="secundario" onClick={() => abrirArquivo(atual.caminho)}>Ver o arquivo enviado</button>}
                {aberto !== t.id && <button type="button" onClick={() => abrir(t.id)}>{atual ? 'Enviar um novo' : 'Enviar'}</button>}
              </div>
              {aberto === t.id && (
                <form onSubmit={(e) => enviar(e, t)} className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }} aria-label={`Enviar ${t.nome}`}>
                  <label>Foto ou PDF do documento
                    <input type="file" accept="image/*,application/pdf" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
                  </label>
                  {t.tem_validade && (
                    <label>Validade
                      <input type="date" required value={form.validade} onChange={(e) => setForm({ ...form, validade: e.target.value })} />
                    </label>
                  )}
                  {t.e_cnh && (
                    <>
                      <label>Número de registro
                        <input required inputMode="numeric" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                      </label>
                      <label>Categoria
                        <select required value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                          <option value="">Selecione…</option>
                          {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </label>
                    </>
                  )}
                  <div className="acoes">
                    <button type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar para conferência'}</button>
                    <button type="button" className="secundario" onClick={() => setAberto(null)}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>
          )
        })}
      </section>
      <section className="cartao" aria-label="Termos assinados">
        <h2>Termos assinados</h2>
        {assinados.length === 0 && <p>Você ainda não assinou nenhum termo.</p>}
        <ul>
          {assinados.map(({ a, t }) => (
            <li key={a.id} className="acoes">
              <span>{t.titulo} (versão {t.versao}), assinado em {dataBr(a.assinado_em)}</span>
              <button type="button" className="secundario" onClick={() => baixarTermoAssinado(t, a, empresaNome)}>Baixar PDF</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
