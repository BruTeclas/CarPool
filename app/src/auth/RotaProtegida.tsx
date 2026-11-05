import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function RotaProtegida() {
  const { session, carregando } = useAuth()
  if (carregando) return <p style={{ padding: 16 }}>Carregando…</p>
  if (!session) return <Navigate to="/entrar" replace />
  return <Outlet />
}
