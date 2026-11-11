import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RotaProtegida } from './auth/RotaProtegida'
import { Layout } from './components/Layout'
import { EmpresaProvider } from './lib/empresa'
import Aprovacoes from './pages/Aprovacoes'
import Entrar from './pages/Entrar'
import Estrutura from './pages/Estrutura'
import Frota from './pages/Frota'
import Grupos from './pages/Grupos'
import MeuPerfil from './pages/MeuPerfil'
import MinhasReservas from './pages/MinhasReservas'
import Pessoas from './pages/Pessoas'
import Politicas from './pages/Politicas'
import ReservaDetalhe from './pages/ReservaDetalhe'
import Reservar from './pages/Reservar'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route element={<RotaProtegida />}>
            <Route element={<EmpresaProvider><Layout /></EmpresaProvider>}>
              <Route path="/" element={<MeuPerfil />} />
              <Route path="/reservar" element={<Reservar />} />
              <Route path="/reservas" element={<MinhasReservas />} />
              <Route path="/reservas/:id" element={<ReservaDetalhe />} />
              <Route path="/aprovacoes" element={<Aprovacoes />} />
              <Route path="/frota" element={<Frota />} />
              <Route path="/estrutura" element={<Estrutura />} />
              <Route path="/pessoas" element={<Pessoas />} />
              <Route path="/grupos" element={<Grupos />} />
              <Route path="/politicas" element={<Politicas />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
