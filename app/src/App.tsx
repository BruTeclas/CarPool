import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RotaProtegida } from './auth/RotaProtegida'
import Entrar from './pages/Entrar'
import MeuPerfil from './pages/MeuPerfil'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route element={<RotaProtegida />}>
            <Route path="/" element={<MeuPerfil />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
