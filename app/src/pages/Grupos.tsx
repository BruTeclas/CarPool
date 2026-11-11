import { useCallback, useEffect, useState } from 'react'
import { Crud } from '../components/Crud'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeCadastro } from '../lib/erros-banco'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

export default function Grupos() {
  const { empresaId, podeGerir } = useEmpresa()
  const [versao, setVersao] = useState(0)
  const grupos = useOpcoes('grupos', 'id', 'nome', empresaId, versao)
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [grupoId, setGrupoId] = useState('')
  const [pessoaId, setPessoaId] = useState('')
  const [integrantes, setIntegrantes] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!grupoId) return setIntegrantes([])
    const { data } = await supabase.from('grupo_membros').select('user_id').eq('grupo_id', grupoId)
    setIntegrantes((data ?? []).map((l) => l.user_id as string))
  }, [grupoId])

  useEffect(() => { void carregar() }, [carregar])

  async function adicionar() {
    if (!grupoId || !pessoaId) return
    setErro(null)
    const { error } = await supabase.from('grupo_membros').insert({ grupo_id: grupoId, user_id: pessoaId, empresa_id: empresaId })
    if (error) setErro(mensagemDeCadastro(error))
    setPessoaId('')
    await carregar()
  }

  async function remover(userId: string) {
    setErro(null)
    const { error } = await supabase.from('grupo_membros').delete().eq('grupo_id', grupoId).eq('user_id', userId)
    if (error) setErro(mensagemDeCadastro(error))
    await carregar()
  }

  const nome = (id: string) => pessoas.find((p) => p.valor === id)?.rotulo ?? 'Pessoa removida'

  return (
    <main>
      <h1>Grupos</h1>
      <p>Grupos servem para aplicar uma política de uso diferente a parte das pessoas (por exemplo, diretoria ou equipe de campo).</p>
      <Crud titulo="Grupos" tabela="grupos" ordem="nome" podeEditar={podeGerir} aoMudar={() => setVersao((v) => v + 1)}
        campos={[{ nome: 'nome', rotulo: 'Nome', obrigatorio: true }]} />
      <section className="cartao" aria-label="Integrantes do grupo">
        <h2>Integrantes</h2>
        <label>Grupo
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
            <option value="">Selecione um grupo…</option>
            {grupos.map((g) => <option key={g.valor} value={g.valor}>{g.rotulo}</option>)}
          </select>
        </label>
        {erro && <p role="alert" className="erro">{erro}</p>}
        {grupoId && (
          <>
            <ul>
              {integrantes.length === 0 && <li>Nenhum integrante ainda.</li>}
              {integrantes.map((id) => (
                <li key={id} className="acoes" style={{ marginBottom: 6 }}>
                  {nome(id)}
                  {podeGerir && <button type="button" className="perigo" onClick={() => remover(id)}>Remover</button>}
                </li>
              ))}
            </ul>
            {podeGerir && (
              <div className="acoes">
                <select aria-label="Pessoa para adicionar" value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} style={{ maxWidth: 280 }}>
                  <option value="">Adicionar pessoa…</option>
                  {pessoas.filter((p) => !integrantes.includes(p.valor)).map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                </select>
                <button type="button" onClick={adicionar} disabled={!pessoaId}>Adicionar ao grupo</button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
