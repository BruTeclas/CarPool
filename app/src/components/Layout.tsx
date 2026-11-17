import { useCallback, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useContagem } from '../lib/avisos'
import { useEmpresa } from '../lib/empresa'
import type { Modulo } from '../lib/empresa'
import { supabase } from '../lib/supabase'
import { PortaoDePrivacidade } from './AvisoPrivacidade'
import { Icone } from './Icone'
import { PopupComunicados } from './PopupComunicados'

type Item = { para: string; rotulo: string; icone: string }

/** Telas que pertencem a um módulo que o super admin liga ou desliga por empresa */
const MODULO_DA_ROTA: Record<string, Modulo> = {
  '/meus-documentos': 'documentos', '/documentos': 'documentos', '/termos': 'documentos',
  '/incidentes': 'ocorrencias',
  '/comunicados': 'treinamentos', '/meus-treinamentos': 'treinamentos', '/treinamentos': 'treinamentos',
  '/relatorios': 'relatorios',
}
const moduloDe = (caminho: string) => MODULO_DA_ROTA['/' + (caminho.split('/')[1] ?? '')]
/** Com a empresa suspensa, só dá para ver os avisos e devolver o carro */
const LIBERADO_NA_SUSPENSAO = ['/avisos', '/reservas', '/']

export function Layout() {
  const { session } = useAuth()
  const { empresaNome, ehAdmin, podeGerir, podeAprovar, podeOperar, podeVerRelatorios, carregando, empresaId, semConexao, modulos, suspensa, motivoSuspensao, suporteAte, superAdmin } = useEmpresa()
  const local = useLocation()
  const [aberto, setAberto] = useState(false)
  const uid = session?.user.id
  const consultaAvisos = useCallback(() => supabase.from('notificacoes').select('id', { count: 'exact', head: true })
    .eq('user_id', uid ?? '').is('lida_em', null), [uid])
  const consultaAbertas = useCallback(() => supabase.from('incidentes').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId ?? '').eq('status', 'aberta'), [empresaId])
  const naoLidos = useContagem(uid ? consultaAvisos : null)
  const abertas = useContagem(podeOperar && empresaId ? consultaAbertas : null)
  const contadores: Record<string, number> = { '/avisos': naoLidos, '/incidentes': podeOperar ? abertas : 0 }

  const grupos: { titulo: string; itens: Item[] }[] = [
    { titulo: 'Uso', itens: [{ para: '/avisos', icone: 'avisos', rotulo: 'Avisos' }, { para: '/reservar', icone: 'reservar', rotulo: 'Reservar' }, { para: '/reservas', icone: 'reservas', rotulo: 'Minhas reservas' }, { para: '/meus-documentos', icone: 'documentos', rotulo: 'Meus documentos' }, { para: '/meus-treinamentos', icone: 'treinamentos', rotulo: 'Meus treinamentos' }] },
    {
      titulo: 'Operação',
      itens: [
        ...(podeAprovar ? [{ para: '/aprovacoes', icone: 'aprovacoes', rotulo: 'Aprovações' }] : []),
        ...(podeGerir ? [{ para: '/documentos', icone: 'documentos', rotulo: 'Documentos' }] : []),
        ...(podeOperar ? [{ para: '/incidentes', icone: 'alerta', rotulo: 'Ocorrências' }, { para: '/comunicados', icone: 'comunicados', rotulo: 'Comunicados' }] : []),
        ...(podeVerRelatorios ? [{ para: '/relatorios', icone: 'relatorios', rotulo: 'Relatórios' }] : []),
        ...(podeOperar ? [{ para: '/portaria', icone: 'portaria', rotulo: 'Portaria' }, { para: '/conferencia', icone: 'conferencia', rotulo: 'Conferência' }] : []),
      ],
    },
    {
      titulo: 'Cadastros',
      itens: [
        ...(podeGerir ? [{ para: '/frota', icone: 'frota', rotulo: 'Frota' }] : []),
        ...(podeOperar ? [{ para: '/etiquetas', icone: 'etiquetas', rotulo: 'Etiquetas das chaves' }] : []),
        ...(podeGerir ? [
          { para: '/estrutura', icone: 'estrutura', rotulo: 'Filiais e bases' }, { para: '/pessoas', icone: 'pessoas', rotulo: 'Pessoas' },
          { para: '/grupos', icone: 'grupos', rotulo: 'Grupos' }, { para: '/checklist', icone: 'conferencia', rotulo: 'Checklist da vistoria' }, { para: '/politicas', icone: 'politicas', rotulo: 'Políticas de uso' }, { para: '/termos', icone: 'termos', rotulo: 'Termos de uso' },
          { para: '/treinamentos', icone: 'treinamentos', rotulo: 'Treinamentos' },
        ] : []),
        ...(ehAdmin ? [{ para: '/privacidade', icone: 'privacidade', rotulo: 'Privacidade e dados' }] : []),
      ],
    },
  ].map((g) => ({ ...g, itens: g.itens.filter((i) => {
    const m = moduloDe(i.para)
    return (!m || modulos.includes(m)) && (!suspensa || LIBERADO_NA_SUSPENSAO.includes(i.para))
  }) })).filter((g) => g.itens.length > 0)

  const moduloAtual = moduloDe(local.pathname)
  const bloqueadaAqui = (moduloAtual && !modulos.includes(moduloAtual))
    || (suspensa && !LIBERADO_NA_SUSPENSAO.some((r) => r === '/' ? local.pathname === '/' : local.pathname.startsWith(r)))

  async function sairDoSuporte() {
    await supabase.rpc('super_sair_suporte')
    try { localStorage.removeItem(`carpool.vinculos.${uid}`) } catch { /* sem storage */ }
    window.location.href = '/super'
  }

  return (
    <div className="moldura">
      <header className="lateral">
        <div className="lateral-topo">
          <span className="marca"><span className="marca-icone"><Icone nome="chave" tamanho={18} /></span>Car Pool</span>
          <button type="button" className="menu-botao" aria-expanded={aberto} aria-controls="navegacao" onClick={() => setAberto(!aberto)}>
            {aberto ? 'Fechar' : 'Menu'}
          </button>
        </div>
        <nav id="navegacao" aria-label="Principal" className={aberto ? 'aberto' : ''} onClick={() => setAberto(false)}>
          {grupos.map((g) => (
            <div key={g.titulo} className="nav-grupo">
              <p className="nav-titulo">{g.titulo}</p>
              {g.itens.map((i) => (
                <NavLink key={i.para} to={i.para}><Icone nome={i.icone} />{i.rotulo}
                  {contadores[i.para] > 0 && <span className={`contador${i.para === '/incidentes' ? ' urgente' : ''}`} aria-label={`${contadores[i.para]} novos`}>{contadores[i.para]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="nav-grupo nav-conta">
            <p className="nav-titulo">{empresaNome || 'Conta'}</p>
            {superAdmin && <NavLink to="/super"><Icone nome="estrutura" />Painel do super admin</NavLink>}
            <NavLink to="/" end><Icone nome="perfil" /><span className="nav-texto">Meu perfil<span className="nav-email">{session?.user.email}</span></span></NavLink>
            <button type="button" className="nav-sair" onClick={() => supabase.auth.signOut()}><Icone nome="sair" />Sair</button>
          </div>
        </nav>
      </header>
      <div className="conteudo">
        {suporteAte && (
          <div className="faixa-suporte" role="status">
            <span><strong>Modo suporte</strong> em {empresaNome}, até {new Date(suporteAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Tudo o que você fizer fica registrado.</span>
            <button type="button" className="secundario" onClick={sairDoSuporte}>Sair do modo suporte</button>
          </div>
        )}
        {suspensa && !suporteAte && (
          <div className="faixa-suspensa" role="alert">
            <strong>Acesso suspenso.</strong> {motivoSuspensao ? `${motivoSuspensao}. ` : ''}Novas reservas e retiradas estão bloqueadas; quem está com um carro ainda consegue devolver. Fale com o suporte.
          </div>
        )}
        {!carregando && !empresaId ? (
          superAdmin && !semConexao ? <Navigate to="/super" replace /> : (
            <main><p role="alert" className="erro">{semConexao
              ? 'Sem sinal. Abra o aplicativo uma vez com internet para ele funcionar também sem sinal neste aparelho.'
              : 'Seu usuário ainda não está vinculado a nenhuma empresa. Fale com o administrador.'}</p></main>
          )
        ) : bloqueadaAqui && !carregando ? (
          <main><p role="alert" className="erro">{suspensa
            ? 'Esta função está indisponível enquanto o acesso da empresa estiver suspenso.'
            : 'Este módulo não está liberado para a sua empresa. Fale com o suporte para contratar.'}</p>
            <p><Link to="/">Voltar ao início</Link></p></main>
        ) : (
          <PortaoDePrivacidade><Outlet /><PopupComunicados /></PortaoDePrivacidade>
        )}
      </div>
    </div>
  )
}
