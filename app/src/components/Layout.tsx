import { useCallback, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useContagem } from '../lib/avisos'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'
import { PortaoDePrivacidade } from './AvisoPrivacidade'
import { Icone } from './Icone'

type Item = { para: string; rotulo: string; icone: string }

export function Layout() {
  const { session } = useAuth()
  const { empresaNome, ehAdmin, podeGerir, podeAprovar, podeOperar, podeVerRelatorios, carregando, empresaId } = useEmpresa()
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
    { titulo: 'Uso', itens: [{ para: '/avisos', icone: 'avisos', rotulo: 'Avisos' }, { para: '/reservar', icone: 'reservar', rotulo: 'Reservar' }, { para: '/reservas', icone: 'reservas', rotulo: 'Minhas reservas' }, { para: '/meus-documentos', icone: 'documentos', rotulo: 'Meus documentos' }] },
    {
      titulo: 'Operação',
      itens: [
        ...(podeAprovar ? [{ para: '/aprovacoes', icone: 'aprovacoes', rotulo: 'Aprovações' }] : []),
        ...(podeGerir ? [{ para: '/documentos', icone: 'documentos', rotulo: 'Documentos' }] : []),
        ...(podeOperar ? [{ para: '/incidentes', icone: 'alerta', rotulo: 'Ocorrências' }] : []),
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
        ] : []),
        ...(ehAdmin ? [{ para: '/privacidade', icone: 'privacidade', rotulo: 'Privacidade e dados' }] : []),
      ],
    },
  ].filter((g) => g.itens.length > 0)

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
            <NavLink to="/" end><Icone nome="perfil" /><span className="nav-texto">Meu perfil<span className="nav-email">{session?.user.email}</span></span></NavLink>
            <button type="button" className="nav-sair" onClick={() => supabase.auth.signOut()}><Icone nome="sair" />Sair</button>
          </div>
        </nav>
      </header>
      <div className="conteudo">
        {!carregando && !empresaId ? (
          <main><p role="alert" className="erro">Seu usuário ainda não está vinculado a nenhuma empresa. Fale com o administrador.</p></main>
        ) : (
          <PortaoDePrivacidade><Outlet /></PortaoDePrivacidade>
        )}
      </div>
    </div>
  )
}
