import { useState } from 'react'
import type { FormEvent } from 'react'
import { Crud } from '../components/Crud'
import { useEmpresa } from '../lib/empresa'
import { useOpcoes } from '../lib/opcoes'
import { PERFIS } from '../lib/perfis'
import { supabase } from '../lib/supabase'

const SIM_NAO = [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }]
const CNH = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map((c) => ({ valor: c, rotulo: c }))

export default function Pessoas() {
  const { empresaId, podeGerir, ehAdmin } = useEmpresa()
  const [versao, setVersao] = useState(0)
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId, versao)
  const [novo, setNovo] = useState({ nome: '', email: '', perfil: 'motorista' })
  const [enviando, setEnviando] = useState(false)
  const [retorno, setRetorno] = useState<{ erro?: string; senha?: string; email?: string; existente?: boolean } | null>(null)

  async function convidar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setRetorno(null)
    const { data, error } = await supabase.functions.invoke('criar-membro', {
      body: { empresa_id: empresaId, ...novo },
    })
    setEnviando(false)
    if (error || data?.erro) {
      let msg: string | undefined = data?.erro
      if (!msg && error && 'context' in error) {
        try { msg = (await (error.context as Response).json()).erro } catch { /* resposta sem corpo */ }
      }
      return setRetorno({ erro: msg ?? 'Não foi possível adicionar a pessoa.' })
    }
    setRetorno({ senha: data.senha_temporaria, email: novo.email, existente: !data.senha_temporaria })
    setNovo({ nome: '', email: '', perfil: novo.perfil })
    setVersao((v) => v + 1)
  }

  return (
    <main>
      <h1>Pessoas</h1>
      {ehAdmin && (
        <section className="cartao" aria-label="Adicionar pessoa">
          <h2>Adicionar pessoa</h2>
          <form onSubmit={convidar} className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <label>Nome
              <input required value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            </label>
            <label>E-mail
              <input type="email" required value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            </label>
            <label>Perfil
              <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}>
                {PERFIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
              </select>
            </label>
            <div className="acoes"><button type="submit" disabled={enviando}>{enviando ? 'Adicionando…' : 'Adicionar'}</button></div>
          </form>
          {retorno?.erro && <p role="alert" className="erro">{retorno.erro}</p>}
          {retorno?.senha && (
            <p role="status" className="aviso">
              Acesso criado para {retorno.email}. Senha provisória: <code>{retorno.senha}</code><br />
              Anote agora: ela não será mostrada de novo. Peça para a pessoa trocar em "Meu perfil".
            </p>
          )}
          {retorno?.existente && (
            <p role="status" className="aviso">{retorno.email} já tinha conta e foi vinculado à empresa com o novo perfil.</p>
          )}
        </section>
      )}
      <Crud titulo="Pessoas e perfis" tabela="membros" ordem="nome" podeEditar={ehAdmin} semCriar semExcluir versao={versao}
        aoMudar={() => setVersao((v) => v + 1)}
        campos={[
          { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
          { nome: 'perfil', rotulo: 'Perfil', tipo: 'selecao', opcoes: PERFIS, obrigatorio: true },
          { nome: 'ativo', rotulo: 'Ativo', tipo: 'selecao', opcoes: SIM_NAO, obrigatorio: true, converter: (v) => v === 'true' },
        ]} />
      <Crud titulo="CNH dos condutores" tabela="cnhs" ordem="validade" podeEditar={podeGerir} versao={versao}
        campos={[
          { nome: 'user_id', rotulo: 'Pessoa', tipo: 'selecao', opcoes: pessoas, obrigatorio: true },
          { nome: 'numero', rotulo: 'Número', obrigatorio: true },
          { nome: 'categoria', rotulo: 'Categoria', tipo: 'selecao', opcoes: CNH, obrigatorio: true },
          { nome: 'validade', rotulo: 'Validade', tipo: 'data', obrigatorio: true },
          { nome: 'ultima_revalidacao', rotulo: 'Última conferência', tipo: 'data' },
        ]} />
    </main>
  )
}
