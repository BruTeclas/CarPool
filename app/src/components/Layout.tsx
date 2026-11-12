import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'
import { Icone } from './Icone'

type Item = { para: string; rotulo: string; icone: string }

export function Layout() {
  const { session } = useAuth()
  const { empresaNome, podeGerir, podeAprovar, podeOperar, carregando, empresaId } = useEmpresa()
  const [aberto, setAberto] = useState(false)

  const grupos: { titulo: string; itens: Item[] }[] = [
    { titulo: 'Uso', itens: [{ para: '/reservar', icone: 'reservar', rotulo: 'Reservar' }, { para: '/reservas', icone: 'reservas', rotulo: 'Minhas reservas' }] },
    {
      titulo: 'Operação',
      itens: [
        ...(podeAprovar ? [{ para: '/aprovacoes', icone: 'aprovacoes', rotulo: 'Aprovações' }] : []),
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
          { para: '/grupos', icone: 'grupos', rotulo: 'Grupos' }, { para: '/politicas', icone: 'politicas', rotulo: 'Políticas de uso' },
        ] : []),
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
              {g.itens.map((i) => <NavLink key={i.para} to={i.para}><Icone nome={i.icone} />{i.rotulo}</NavLink>)}
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
          <Outlet />
        )}
      </div>
    </div>
  )
}
