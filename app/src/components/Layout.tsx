import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'

type Item = { para: string; rotulo: string; fim?: boolean }

export function Layout() {
  const { session } = useAuth()
  const { empresaNome, podeGerir, podeAprovar, podeOperar, carregando, empresaId } = useEmpresa()
  const [aberto, setAberto] = useState(false)

  const grupos: { titulo: string; itens: Item[] }[] = [
    { titulo: 'Uso', itens: [{ para: '/reservar', rotulo: 'Reservar' }, { para: '/reservas', rotulo: 'Minhas reservas' }] },
    {
      titulo: 'Operação',
      itens: [
        ...(podeAprovar ? [{ para: '/aprovacoes', rotulo: 'Aprovações' }] : []),
        ...(podeOperar ? [{ para: '/portaria', rotulo: 'Portaria' }, { para: '/conferencia', rotulo: 'Conferência' }] : []),
      ],
    },
    {
      titulo: 'Cadastros',
      itens: [
        ...(podeGerir ? [{ para: '/frota', rotulo: 'Frota' }] : []),
        ...(podeOperar ? [{ para: '/etiquetas', rotulo: 'Etiquetas das chaves' }] : []),
        ...(podeGerir ? [
          { para: '/estrutura', rotulo: 'Filiais e bases' }, { para: '/pessoas', rotulo: 'Pessoas' },
          { para: '/grupos', rotulo: 'Grupos' }, { para: '/politicas', rotulo: 'Políticas de uso' },
        ] : []),
      ],
    },
  ].filter((g) => g.itens.length > 0)

  return (
    <div className="moldura">
      <header className="lateral">
        <div className="lateral-topo">
          <span className="marca">Car Pool</span>
          <button type="button" className="menu-botao" aria-expanded={aberto} aria-controls="navegacao" onClick={() => setAberto(!aberto)}>
            {aberto ? 'Fechar' : 'Menu'}
          </button>
        </div>
        <nav id="navegacao" aria-label="Principal" className={aberto ? 'aberto' : ''} onClick={() => setAberto(false)}>
          {grupos.map((g) => (
            <div key={g.titulo} className="nav-grupo">
              <p className="nav-titulo">{g.titulo}</p>
              {g.itens.map((i) => <NavLink key={i.para} to={i.para}>{i.rotulo}</NavLink>)}
            </div>
          ))}
          <div className="nav-grupo nav-conta">
            <p className="nav-titulo">{empresaNome || 'Conta'}</p>
            <NavLink to="/" end>Meu perfil<span className="nav-email">{session?.user.email}</span></NavLink>
            <button type="button" className="nav-sair" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        </nav>
      </header>
      <div className="conteudo">
        {!carregando && !empresaId ? (
          <main><p role="alert" className="erro">Seu usuário ainda não está vinculado a nenhuma empresa. Fale com o administrador.</p></main>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
