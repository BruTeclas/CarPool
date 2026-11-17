import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icone } from '../components/Icone'
import { formatarDataHora } from '../lib/datas'
import { mensagemDeErro } from '../lib/erros'
import { cnpjValido, formatarCnpj, limiteTexto, MODULOS } from '../lib/superadmin'
import type { EmpresaResumo } from '../lib/superadmin'
import { supabase } from '../lib/supabase'
import type { Modulo } from '../lib/empresa'

type Mensagem = { texto: string; erro: boolean } | null
type SuperAdminLinha = { user_id: string; nome: string | null; email: string; criado_em: string; ultimo_acesso: string | null }

export function Retorno({ m }: { m: Mensagem }) {
  return m ? <p role={m.erro ? 'alert' : 'status'} className={m.erro ? 'erro' : 'sucesso'}>{m.texto}</p> : null
}

/** Moldura das telas do super admin: separada do menu dos clientes */
export function MolduraSuper({ titulo, children }: { titulo: string; children: ReactNode }) {
  const { session } = useAuth()
  const [eu, setEu] = useState<boolean | null>(null)
  useEffect(() => { void supabase.rpc('sou_super_admin').then(({ data }) => setEu(data === true)) }, [])
  // Só mostra "Área da empresa" para quem também é membro de alguma empresa (fora do modo suporte)
  const [temEmpresa, setTemEmpresa] = useState(false)
  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    void supabase.from('membros').select('empresa_id').eq('user_id', uid).eq('ativo', true).is('suporte_ate', null).limit(1)
      .then(({ data }) => setTemEmpresa((data?.length ?? 0) > 0))
  }, [uid])
  return (
    <div className="super">
      <header className="super-topo">
        <Link to="/super" className="marca"><span className="marca-icone"><Icone nome="chave" tamanho={18} /></span>Car Pool · Super admin</Link>
        <span className="super-conta">
          <span className="nav-email">{session?.user.email}</span>
          {temEmpresa && <Link to="/">Área da empresa</Link>}
          <button type="button" className="secundario" onClick={() => supabase.auth.signOut()}>Sair</button>
        </span>
      </header>
      <main>
        <h1>{titulo}</h1>
        {eu === null ? <p>Carregando…</p> : eu ? children : <p role="alert" className="erro">Esta área é só da equipe do sistema (super admin).</p>}
      </main>
    </div>
  )
}

export type DadosEmpresa = { nome: string; razao: string; cnpj: string; modulos: Modulo[]; usuarios: string; veiculos: string; filiais: string }
export const vazia = (): DadosEmpresa => ({ nome: '', razao: '', cnpj: '', modulos: MODULOS.map((m) => m.valor), usuarios: '', veiculos: '', filiais: '' })

/** Formulário de dados, módulos e limites (usado para criar e para editar) */
export function FormEmpresa({ inicial, rotulo, aoSalvar }: { inicial: DadosEmpresa; rotulo: string; aoSalvar: (d: DadosEmpresa) => Promise<string | null> }) {
  const [d, setD] = useState(inicial)
  const [msg, setMsg] = useState<Mensagem>(null)
  const [salvando, setSalvando] = useState(false)
  const muda = <K extends keyof DadosEmpresa>(k: K, v: DadosEmpresa[K]) => setD((x) => ({ ...x, [k]: v }))

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (d.cnpj.trim() && !cnpjValido(d.cnpj)) return setMsg({ texto: 'CNPJ inválido. Confira os números.', erro: true })
    setSalvando(true)
    const erro = await aoSalvar(d)
    setSalvando(false)
    setMsg(erro ? { texto: erro, erro: true } : { texto: 'Salvo.', erro: false })
  }

  return (
    <form onSubmit={enviar} style={{ display: 'grid', gap: 16 }}>
      <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        <label>Nome (como aparece no sistema)
          <input required maxLength={120} value={d.nome} onChange={(e) => muda('nome', e.target.value)} placeholder="Ex.: Transportes Silva" />
        </label>
        <label>Razão social
          <input maxLength={200} value={d.razao} onChange={(e) => muda('razao', e.target.value)} />
        </label>
        <label>CNPJ
          <input inputMode="numeric" value={d.cnpj} onChange={(e) => muda('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
        </label>
      </div>
      <fieldset>
        <legend>Módulos liberados</legend>
        <p><small>Reserva, vistoria e chave são o básico e ficam sempre ligados. Módulo desligado some do menu e as regras dele deixam de valer.</small></p>
        {MODULOS.map((m) => (
          <label key={m.valor} className="linha">
            <input type="checkbox" checked={d.modulos.includes(m.valor)}
              onChange={() => muda('modulos', d.modulos.includes(m.valor) ? d.modulos.filter((x) => x !== m.valor) : [...d.modulos, m.valor])} />
            <span><strong>{m.rotulo}.</strong> {m.ajuda}</span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Limites do plano</legend>
        <p><small>Em branco, sem limite. Ao chegar no limite, o admin da empresa não consegue cadastrar mais.</small></p>
        <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          <label>Usuários<input type="number" min={1} value={d.usuarios} onChange={(e) => muda('usuarios', e.target.value)} /></label>
          <label>Veículos<input type="number" min={1} value={d.veiculos} onChange={(e) => muda('veiculos', e.target.value)} /></label>
          <label>Filiais<input type="number" min={1} value={d.filiais} onChange={(e) => muda('filiais', e.target.value)} /></label>
        </div>
      </fieldset>
      <div className="acoes"><button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : rotulo}</button></div>
      <Retorno m={msg} />
    </form>
  )
}

export async function salvarEmpresa(id: string | null, d: DadosEmpresa): Promise<{ id: string | null; erro: string | null }> {
  const num = (v: string) => (v.trim() ? Number(v) : null)
  const { data, error } = await supabase.rpc('super_salvar_empresa', {
    p_id: id, p_nome: d.nome, p_razao_social: d.razao, p_cnpj: d.cnpj, p_modulos: d.modulos,
    p_limite_usuarios: num(d.usuarios), p_limite_veiculos: num(d.veiculos), p_limite_filiais: num(d.filiais),
  })
  return { id: (data as string) ?? null, erro: error ? mensagemDeErro(error) : null }
}

export default function Super() {
  const navegar = useNavigate()
  const { session } = useAuth()
  const [empresas, setEmpresas] = useState<EmpresaResumo[] | null>(null)
  const [supers, setSupers] = useState<SuperAdminLinha[]>([])
  const [busca, setBusca] = useState('')
  const [novoSuper, setNovoSuper] = useState({ email: '', nome: '' })
  const [msgSuper, setMsgSuper] = useState<Mensagem>(null)

  const carregar = useCallback(async () => {
    const [e, s] = await Promise.all([supabase.rpc('super_empresas'), supabase.rpc('super_lista_super_admins')])
    setEmpresas((e.data as EmpresaResumo[]) ?? [])
    setSupers((s.data as SuperAdminLinha[]) ?? [])
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  async function adicionarSuper(e: FormEvent) {
    e.preventDefault()
    setMsgSuper(null)
    const { error } = await supabase.rpc('super_adicionar_super_admin', { p_email: novoSuper.email, p_nome: novoSuper.nome })
    if (error) return setMsgSuper({ texto: error.message.includes('usuario_nao_encontrado') ? 'Não há conta com esse e-mail. A pessoa precisa ter uma conta antes (crie no painel do Supabase ou convide como admin de alguma empresa).' : mensagemDeErro(error), erro: true })
    setNovoSuper({ email: '', nome: '' })
    setMsgSuper({ texto: 'Super admin adicionado.', erro: false })
    await carregar()
  }

  async function removerSuper(s: SuperAdminLinha) {
    if (!window.confirm(`Tirar o acesso de super admin de ${s.email}?`)) return
    const { error } = await supabase.rpc('super_remover_super_admin', { p_user: s.user_id })
    if (error) return setMsgSuper({ texto: mensagemDeErro(error), erro: true })
    await carregar()
  }

  const lista = (empresas ?? []).filter((x) => !busca || `${x.nome} ${x.razao_social ?? ''} ${x.cnpj ?? ''}`.toLowerCase().includes(busca.toLowerCase().replace(/[./-]/g, '')) || formatarCnpj(x.cnpj).includes(busca))
  const ativas = (empresas ?? []).filter((x) => x.situacao === 'ativa')
  const soma = (k: 'usuarios' | 'veiculos' | 'reservas_30d') => ativas.reduce((s, x) => s + x[k], 0)

  return (
    <MolduraSuper titulo="Painel do super admin">
      <div className="indicadores">
        <div className="indicador"><span>Empresas ativas</span><strong>{ativas.length}</strong></div>
        <div className="indicador"><span>Suspensas</span><strong>{(empresas ?? []).length - ativas.length}</strong></div>
        <div className="indicador"><span>Usuários</span><strong>{soma('usuarios')}</strong></div>
        <div className="indicador"><span>Veículos</span><strong>{soma('veiculos')}</strong></div>
        <div className="indicador"><span>Reservas em 30 dias</span><strong>{soma('reservas_30d')}</strong></div>
      </div>

      <section className="cartao" aria-label="Empresas">
        <div className="doc-topo"><h2>Empresas</h2>
          <label className="so-leitor" htmlFor="busca-empresa">Buscar empresa</label>
          <input id="busca-empresa" style={{ maxWidth: 280 }} placeholder="Buscar por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {empresas === null && <p>Carregando…</p>}
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Empresa</th><th>Situação</th><th>Usuários</th><th>Veículos</th><th>Filiais</th><th>Reservas 30 d</th><th>Último acesso</th><th>Módulos</th></tr></thead>
            <tbody>
              {empresas && lista.length === 0 && <tr><td colSpan={8} className="vazio">Nenhuma empresa.</td></tr>}
              {lista.map((x) => (
                <tr key={x.id}>
                  <td><Link to={`/super/empresas/${x.id}`}><strong>{x.nome}</strong></Link><br /><small>{x.cnpj ? formatarCnpj(x.cnpj) : 'sem CNPJ'}</small></td>
                  <td><span className={`situacao ${x.situacao === 'ativa' ? 's-aprovada' : 's-atrasada'}`}>{x.situacao === 'ativa' ? 'Ativa' : 'Suspensa'}</span>{x.admins === 0 && <><br /><small>sem admin</small></>}</td>
                  <td>{limiteTexto(x.usuarios, x.limite_usuarios)}</td>
                  <td>{limiteTexto(x.veiculos, x.limite_veiculos)}</td>
                  <td>{limiteTexto(x.filiais, x.limite_filiais)}</td>
                  <td>{x.reservas_30d}</td>
                  <td>{x.ultimo_acesso ? formatarDataHora(x.ultimo_acesso) : '—'}</td>
                  <td>{x.modulos.length} de {MODULOS.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cartao" aria-label="Nova empresa">
        <h2>Nova empresa</h2>
        <p>Depois de salvar, convide o administrador da empresa na tela dela.</p>
        <FormEmpresa inicial={vazia()} rotulo="Cadastrar empresa" aoSalvar={async (d) => {
          const r = await salvarEmpresa(null, d)
          if (!r.erro && r.id) navegar(`/super/empresas/${r.id}`)
          return r.erro
        }} />
      </section>

      <section className="cartao" aria-label="Super admins">
        <h2>Super admins</h2>
        <p>A equipe que administra o sistema. Tudo o que cada um faz fica registrado.</p>
        <ul>
          {supers.map((s) => (
            <li key={s.user_id} className="acoes" style={{ justifyContent: 'space-between' }}>
              <span>{s.nome ? `${s.nome} · ` : ''}{s.email}<br /><small>Último acesso: {s.ultimo_acesso ? formatarDataHora(s.ultimo_acesso) : '—'}</small></span>
              {s.user_id !== session?.user.id && <button type="button" className="perigo" onClick={() => removerSuper(s)}>Remover</button>}
            </li>
          ))}
        </ul>
        <form onSubmit={adicionarSuper} className="form-grade">
          <label>E-mail da pessoa<input type="email" required value={novoSuper.email} onChange={(e) => setNovoSuper({ ...novoSuper, email: e.target.value })} /></label>
          <label>Nome<input value={novoSuper.nome} onChange={(e) => setNovoSuper({ ...novoSuper, nome: e.target.value })} /></label>
          <div className="acoes"><button type="submit">Adicionar super admin</button></div>
        </form>
        <Retorno m={msgSuper} />
      </section>
    </MolduraSuper>
  )
}
