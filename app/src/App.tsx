import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RotaProtegida } from './auth/RotaProtegida'
import { Layout } from './components/Layout'
import { Sincronizador } from './components/Sincronizador'
import { EmpresaProvider } from './lib/empresa'
import Aprovacoes from './pages/Aprovacoes'
import Chave from './pages/Chave'
import Checklist from './pages/Checklist'
import Conferencia from './pages/Conferencia'
import Entrar from './pages/Entrar'
import Etiquetas from './pages/Etiquetas'
import Estrutura from './pages/Estrutura'
import Frota from './pages/Frota'
import Grupos from './pages/Grupos'
import MeuPerfil from './pages/MeuPerfil'
import MinhasReservas from './pages/MinhasReservas'
import Pessoas from './pages/Pessoas'
import Politicas from './pages/Politicas'
import Portaria from './pages/Portaria'
import ReservaDetalhe from './pages/ReservaDetalhe'
import Reservar from './pages/Reservar'
import Vistoria from './pages/Vistoria'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Sincronizador />
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/k/:codigo" element={<Chave />} />
          <Route element={<RotaProtegida />}>
            <Route element={<EmpresaProvider><Layout /></EmpresaProvider>}>
              <Route path="/" element={<MeuPerfil />} />
              <Route path="/reservar" element={<Reservar />} />
              <Route path="/reservas" element={<MinhasReservas />} />
              <Route path="/reservas/:id" element={<ReservaDetalhe />} />
              <Route path="/reservas/:id/vistoria/:tipo" element={<Vistoria />} />
              <Route path="/portaria" element={<Portaria />} />
              <Route path="/conferencia" element={<Conferencia />} />
              <Route path="/etiquetas" element={<Etiquetas />} />
              <Route path="/checklist" element={<Checklist />} />
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
