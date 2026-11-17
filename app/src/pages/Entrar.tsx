import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icone } from '../components/Icone'
import { CampoSenha } from '../components/CampoSenha'
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
  const [aviso, setAviso] = useState<string | null>(null)

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

  async function esqueci() {
    setErro(null)
    setAviso(null)
    if (!email.includes('@')) return setErro('Escreva o seu e-mail acima e clique de novo em “Esqueci minha senha”.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/definir-senha` })
    if (error) return setErro('Não foi possível enviar agora. Tente de novo em alguns minutos.')
    setAviso('Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.')
  }

  return (
    <div className="entrada">
      <main className="entrada-cartao">
        <span className="marca-icone grande"><Icone nome="chave" tamanho={30} /></span>
        <h1>Car Pool</h1>
        <p className="entrada-sub">Entre para reservar, retirar e devolver os veículos da empresa.</p>
      <form onSubmit={entrar}>
        <label>
          E-mail
          <input type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <CampoSenha rotulo="Senha" autoComplete="current-password" required value={senha}
          onChange={(e) => setSenha(e.target.value)} />
        {erro && <p role="alert" className="erro">{erro}</p>}
        {aviso && <p role="status" className="sucesso">{aviso}</p>}
        <button type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        <button type="button" className="secundario" onClick={esqueci}>Esqueci minha senha</button>
      </form>
      </main>
    </div>
  )
}
