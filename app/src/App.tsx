import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RotaProtegida } from './auth/RotaProtegida'
import Entrar from './pages/Entrar'
import MeuPerfil from './pages/MeuPerfil'
import Reservar from './pages/Reservar'
import Veiculos from './pages/Veiculos'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route element={<RotaProtegida />}>
            <Route path="/" element={<MeuPerfil />} />
            <Route path="/reservar" element={<Reservar />} />
            <Route path="/frota" element={<Veiculos />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
