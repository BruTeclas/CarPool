import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export default function Entrar() {
  const { session } = useAuth()
  const navegar = useNavigate()
  const [params] = useSearchParams()
  const pedido = params.get('voltar') ?? ''
  // só caminhos internos, para não redirecionar para fora do site
  const destino = pedido.startsWith('/') && !pedido.startsWith('//') ? pedido : '/'
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (session) return <Navigate to={destino} replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    if (error) setErro('E-mail ou senha inválidos.')
    else navegar(destino, { replace: true })
  }

  return (
    <div className="entrada">
      <aside className="entrada-lado">
        <span className="marca">Car Pool</span>
        <div>
          <p>Reserve, retire e devolva os veículos da empresa. Tudo fica registrado: quem pegou, quando e em que estado voltou.</p>
          <div className="vagas" aria-hidden="true">
            <span /><span className="ocupada"><span className="placa">BRA 2E19</span></span><span /><span />
          </div>
        </div>
      </aside>
      <main className="entrada-form">
      <h1>Entrar</h1>
      <form onSubmit={entrar}>
        <label>
          E-mail
          <input type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" required value={senha}
            onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <p role="alert" className="erro">{erro}</p>}
        <button type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      </main>
    </div>
  )
}
