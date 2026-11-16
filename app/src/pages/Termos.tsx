import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { baixarTermoAssinado, dataBr } from '../lib/documentos'
import type { Assinatura, Termo } from '../lib/documentos'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'

export default function Termos() {
  const { empresaId, empresaNome, ehAdmin, podeGerir } = useEmpresa()
  const [termos, setTermos] = useState<Termo[]>([])
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([])
  const [titulo, setTitulo] = useState('Termo de uso dos veículos')
  const [texto, setTexto] = useState('')
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const [t, a] = await Promise.all([
      supabase.from('termos').select('*').eq('empresa_id', empresaId).order('titulo').order('versao', { ascending: false }).returns<Termo[]>(),
      supabase.from('assinaturas_de_termo').select('*').eq('empresa_id', empresaId).order('assinado_em', { ascending: false }).returns<Assinatura[]>(),
    ])
    setTermos(t.data ?? [])
    setAssinaturas(a.data ?? [])
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  async function publicar(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    const nome = titulo.trim()
    // Consulta na hora: a lista da tela pode estar desatualizada ou ainda carregando
    const { data: atuais } = await supabase.from('termos').select('id, versao, ativo')
      .eq('empresa_id', empresaId ?? '').eq('titulo', nome).returns<Pick<Termo, 'id' | 'versao' | 'ativo'>[]>()
    const anteriores = atuais ?? []
    const versao = Math.max(0, ...anteriores.map((t) => t.versao)) + 1
    const { error } = await supabase.from('termos').insert({ empresa_id: empresaId, titulo: nome, texto: texto.trim(), versao })
    if (error) return setMensagem({ texto: 'Não foi possível publicar o termo.', erro: true })
    const ativos = anteriores.filter((t) => t.ativo).map((t) => t.id)
    if (ativos.length) await supabase.from('termos').update({ ativo: false }).in('id', ativos)
    setMensagem({ texto: `Versão ${versao} publicada. Cada pessoa precisa assinar antes da próxima reserva.`, erro: false })
    setTexto('')
    await carregar()
  }

  async function alternar(t: Termo) {
    await supabase.from('termos').update({ ativo: !t.ativo }).eq('id', t.id)
    await carregar()
  }

  if (!podeGerir) return <main><p role="alert" className="erro">Você não tem acesso aos termos.</p></main>

  return (
    <main>
      <h1>Termos de uso</h1>
      <p>O termo ativo precisa ser assinado por cada pessoa antes da primeira reserva. O texto de uma versão publicada não pode mais ser alterado: para mudar, publique uma nova versão.</p>
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
      <section className="cartao" aria-label="Termos publicados">
        <h2>Termos publicados</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Título</th><th>Versão</th><th>Situação</th><th>Assinaturas</th>{ehAdmin && <th><span className="so-leitor">Ações</span></th>}</tr></thead>
            <tbody>
              {termos.length === 0 && <tr><td colSpan={5} className="vazio">Nenhum termo publicado. Sem termo ativo, ninguém precisa assinar nada.</td></tr>}
              {termos.map((t) => (
                <tr key={t.id}>
                  <td>{t.titulo}</td><td>{t.versao}</td><td>{t.ativo ? 'Ativo' : 'Inativo'}</td>
                  <td>{assinaturas.filter((a) => a.termo_id === t.id).length}</td>
                  {ehAdmin && (
                    <td className="acoes">
                      <button type="button" className="secundario" onClick={() => { setTitulo(t.titulo); setTexto(t.texto) }}>Usar como base</button>
                      <button type="button" className="secundario" onClick={() => alternar(t)}>{t.ativo ? 'Desativar' : 'Ativar'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {ehAdmin && (
        <section className="cartao" aria-label="Publicar termo">
          <h2>Publicar termo ou nova versão</h2>
          <form onSubmit={publicar} style={{ display: 'grid', gap: 14 }}>
            <label>Título
              <input required value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </label>
            <label>Texto do termo
              <textarea required rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} />
            </label>
            <div className="acoes"><button type="submit">Publicar</button></div>
          </form>
        </section>
      )}
      <section className="cartao" aria-label="Assinaturas">
        <h2>Assinaturas</h2>
        {assinaturas.length === 0 && <p>Ninguém assinou ainda.</p>}
        <ul>
          {assinaturas.map((a) => {
            const t = termos.find((x) => x.id === a.termo_id)
            return (
              <li key={a.id} className="acoes">
                <span>{a.nome_assinante}, {t?.titulo} (versão {t?.versao}), em {dataBr(a.assinado_em)}</span>
                {t && <button type="button" className="secundario" onClick={() => baixarTermoAssinado(t, a, empresaNome)}>Baixar PDF</button>}
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
