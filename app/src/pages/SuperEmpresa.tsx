import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatarDataHora } from '../lib/datas'
import { mensagemDeErro } from '../lib/erros'
import { formatarCnpj, limiteTexto } from '../lib/superadmin'
import type { EmpresaResumo } from '../lib/superadmin'
import { supabase } from '../lib/supabase'
import { FormEmpresa, MolduraSuper, Retorno, salvarEmpresa } from './Super'

type Mensagem = { texto: string; erro: boolean } | null
type Admin = { user_id: string; nome: string; email: string; ativo: boolean; confirmado: boolean; ultimo_acesso: string | null }

export default function SuperEmpresa() {
  const { id } = useParams()
  const { session } = useAuth()
  const [e, setE] = useState<EmpresaResumo | null>(null)
  const [admins, setAdmins] = useState<Admin[]>([])
  const [convite, setConvite] = useState({ nome: '', email: '' })
  const [motivoSuspensao, setMotivoSuspensao] = useState('')
  const [motivoSuporte, setMotivoSuporte] = useState('')
  const [msg, setMsg] = useState<Record<string, Mensagem>>({})
  const aviso = (k: string, m: Mensagem) => setMsg((x) => ({ ...x, [k]: m }))

  const carregar = useCallback(async () => {
    if (!id) return
    const [lista, a] = await Promise.all([supabase.rpc('super_empresas'), supabase.rpc('super_admins_da_empresa', { p_empresa: id })])
    setE(((lista.data as EmpresaResumo[]) ?? []).find((x) => x.id === id) ?? null)
    setAdmins((a.data as Admin[]) ?? [])
  }, [id])
  useEffect(() => { void carregar() }, [carregar])

  async function convidar(ev: FormEvent) {
    ev.preventDefault()
    aviso('convite', null)
    const { data, error } = await supabase.functions.invoke('convidar-admin', {
      body: { empresa_id: id, nome: convite.nome, email: convite.email, origem: window.location.origin },
    })
    if (error) {
      let texto = 'Não foi possível enviar o convite.'
      try { texto = (await (error as { context?: Response }).context?.json())?.erro ?? texto } catch { /* sem corpo */ }
      return aviso('convite', { texto, erro: true })
    }
    setConvite({ nome: '', email: '' })
    aviso('convite', { texto: (data as { conta_nova: boolean }).conta_nova
      ? 'Convite enviado. A pessoa recebe um e-mail para criar a senha e entrar.'
      : 'Essa pessoa já tinha conta: foi vinculada como administradora e recebeu um e-mail para definir a senha.', erro: false })
    await carregar()
  }

  async function suspender(ev: FormEvent) {
    ev.preventDefault()
    if (!e) return
    const vaiSuspender = e.situacao === 'ativa'
    if (vaiSuspender && !window.confirm(`Suspender ${e.nome}? Ninguém da empresa faz reservas nem retiradas até reativar.`)) return
    const { error } = await supabase.rpc('super_suspender_empresa', { p_id: e.id, p_suspender: vaiSuspender, p_motivo: motivoSuspensao })
    if (error) return aviso('situacao', { texto: mensagemDeErro(error), erro: true })
    setMotivoSuspensao('')
    aviso('situacao', { texto: vaiSuspender ? 'Empresa suspensa.' : 'Empresa reativada.', erro: false })
    await carregar()
  }

  async function entrarComoSuporte(ev: FormEvent) {
    ev.preventDefault()
    aviso('suporte', null)
    const { error } = await supabase.rpc('super_entrar_como', { p_empresa: id, p_motivo: motivoSuporte })
    if (error) return aviso('suporte', { texto: mensagemDeErro(error), erro: true })
    try { localStorage.removeItem(`carpool.vinculos.${session?.user.id}`) } catch { /* sem storage */ }
    window.location.href = '/'
  }

  if (!e) return <MolduraSuper titulo="Empresa"><p>Carregando…</p></MolduraSuper>

  return (
    <MolduraSuper titulo={e.nome}>
      <p><Link to="/super">← Todas as empresas</Link></p>
      <p>
        <span className={`situacao ${e.situacao === 'ativa' ? 's-aprovada' : 's-atrasada'}`}>{e.situacao === 'ativa' ? 'Ativa' : 'Suspensa'}</span>
        {' '}{e.cnpj ? formatarCnpj(e.cnpj) : 'sem CNPJ'}{e.razao_social ? ` · ${e.razao_social}` : ''} · cadastrada em {formatarDataHora(e.criado_em)}
      </p>
      <div className="indicadores">
        <div className="indicador"><span>Usuários</span><strong>{limiteTexto(e.usuarios, e.limite_usuarios)}</strong></div>
        <div className="indicador"><span>Veículos</span><strong>{limiteTexto(e.veiculos, e.limite_veiculos)}</strong></div>
        <div className="indicador"><span>Filiais</span><strong>{limiteTexto(e.filiais, e.limite_filiais)}</strong></div>
        <div className="indicador"><span>Reservas em 30 dias</span><strong>{e.reservas_30d}</strong></div>
        <div className="indicador"><span>Último acesso</span><strong style={{ fontSize: '1rem' }}>{e.ultimo_acesso ? formatarDataHora(e.ultimo_acesso) : '—'}</strong></div>
      </div>

      <section className="cartao" aria-label="Administradores">
        <h2>Administradores da empresa</h2>
        {admins.length === 0 && <p>Nenhum administrador ainda. Convide o gestor da empresa abaixo.</p>}
        <ul>
          {admins.map((a) => (
            <li key={a.user_id}>{a.nome} · {a.email}{!a.ativo && ' (inativo)'}<br />
              <small>{a.confirmado ? `Último acesso: ${a.ultimo_acesso ? formatarDataHora(a.ultimo_acesso) : 'nunca entrou'}` : 'Convite enviado, ainda não criou a senha'}</small></li>
          ))}
        </ul>
        <form onSubmit={convidar} className="form-grade">
          <label>Nome do administrador<input required minLength={3} value={convite.nome} onChange={(ev) => setConvite({ ...convite, nome: ev.target.value })} /></label>
          <label>E-mail<input type="email" required value={convite.email} onChange={(ev) => setConvite({ ...convite, email: ev.target.value })} /></label>
          <div className="acoes"><button type="submit">Enviar convite</button></div>
        </form>
        <p><small>O convite chega por e-mail com um link para a pessoa criar a própria senha. Para reenviar, convide o mesmo e-mail de novo.</small></p>
        <Retorno m={msg.convite ?? null} />
      </section>

      <section className="cartao" aria-label="Dados, módulos e limites">
        <h2>Dados, módulos e limites</h2>
        <FormEmpresa key={e.id} rotulo="Salvar alterações" inicial={{
          nome: e.nome, razao: e.razao_social ?? '', cnpj: e.cnpj ? formatarCnpj(e.cnpj) : '', modulos: e.modulos,
          usuarios: e.limite_usuarios?.toString() ?? '', veiculos: e.limite_veiculos?.toString() ?? '', filiais: e.limite_filiais?.toString() ?? '',
        }} aoSalvar={async (d) => { const r = await salvarEmpresa(e.id, d); if (!r.erro) await carregar(); return r.erro }} />
      </section>

      <section className="cartao" aria-label="Suporte">
        <h2>Entrar como suporte</h2>
        <p>Abre a empresa como administrador, por até 2 horas, para ajudar o cliente. Pode alterar dados. O motivo e tudo o que você fizer ficam registrados na auditoria.</p>
        <form onSubmit={entrarComoSuporte} className="form-grade">
          <label>Motivo do acesso<input required minLength={5} value={motivoSuporte} onChange={(ev) => setMotivoSuporte(ev.target.value)} placeholder="Ex.: chamado 123, ajuda no cadastro da frota" /></label>
          <div className="acoes"><button type="submit">Entrar como suporte</button></div>
        </form>
        <Retorno m={msg.suporte ?? null} />
      </section>

      <section className="cartao" aria-label="Situação">
        <h2>{e.situacao === 'ativa' ? 'Suspender empresa' : 'Reativar empresa'}</h2>
        {e.situacao === 'suspensa'
          ? <p>Suspensa em {e.suspensa_em ? formatarDataHora(e.suspensa_em) : '—'}. Motivo: {e.motivo_suspensao}</p>
          : <p>Com a empresa suspensa, ninguém faz reservas, retiradas nem cadastros; quem está com um carro ainda consegue devolver. Os dados ficam guardados.</p>}
        <form onSubmit={suspender} className="form-grade">
          {e.situacao === 'ativa' && <label>Motivo (aparece para a empresa)<input required minLength={3} value={motivoSuspensao} onChange={(ev) => setMotivoSuspensao(ev.target.value)} placeholder="Ex.: pagamento em atraso" /></label>}
          <div className="acoes"><button type="submit" className={e.situacao === 'ativa' ? 'perigo' : ''}>{e.situacao === 'ativa' ? 'Suspender' : 'Reativar'}</button></div>
        </form>
        <Retorno m={msg.situacao ?? null} />
      </section>
    </MolduraSuper>
  )
}
