import { NavLink, Outlet } from 'react-router-dom'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'

export function Layout() {
  const { empresaNome, podeGerir, podeAprovar, podeOperar, carregando, empresaId } = useEmpresa()
  return (
    <>
      <header className="topo">
        <strong>Car Pool{empresaNome ? ` · ${empresaNome}` : ''}</strong>
        <nav aria-label="Principal">
          <NavLink to="/reservar">Reservar</NavLink>
          <NavLink to="/reservas">Minhas reservas</NavLink>
          {podeAprovar && <NavLink to="/aprovacoes">Aprovações</NavLink>}
          {podeOperar && <NavLink to="/portaria">Portaria</NavLink>}
          {podeOperar && <NavLink to="/conferencia">Conferência</NavLink>}
          {podeGerir && <NavLink to="/frota">Frota</NavLink>}
          {podeOperar && <NavLink to="/etiquetas">Etiquetas</NavLink>}
          {podeGerir && <NavLink to="/estrutura">Filiais e bases</NavLink>}
          {podeGerir && <NavLink to="/pessoas">Pessoas</NavLink>}
          {podeGerir && <NavLink to="/grupos">Grupos</NavLink>}
          {podeGerir && <NavLink to="/politicas">Políticas</NavLink>}
          <NavLink to="/" end>Meu perfil</NavLink>
          <button type="button" className="secundario" onClick={() => supabase.auth.signOut()}>Sair</button>
        </nav>
      </header>
      {!carregando && !empresaId ? (
        <main><p role="alert" className="erro">Seu usuário ainda não está vinculado a nenhuma empresa. Fale com o administrador.</p></main>
      ) : (
        <Outlet />
      )}
    </>
  )
}
