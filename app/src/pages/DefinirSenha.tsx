import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

/** Aberta pelo link do convite ou do "esqueci minha senha": a pessoa cria a própria senha. */
export default function DefinirSenha() {
  const { session, carregando } = useAuth()
  const navegar = useNavigate()
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha !== confirma) return setErro('As duas senhas não são iguais.')
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setSalvando(false)
    if (error) return setErro('Não foi possível salvar. Use ao menos 8 caracteres, misturando letras e números.')
    navegar('/', { replace: true })
  }

  return (
    <div className="entrada">
      <main className="entrada-cartao">
        <h1>Crie sua senha</h1>
        {carregando ? <p>Carregando…</p> : !session ? (
          <p role="alert" className="erro">Este link expirou ou já foi usado. Peça um novo convite, ou use “Esqueci minha senha” na tela de entrada.</p>
        ) : (
          <form onSubmit={salvar} style={{ display: 'grid', gap: 14 }}>
            <p className="entrada-sub">Conta: <strong>{session.user.email}</strong></p>
            <label>Nova senha
              <input type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(e) => setSenha(e.target.value)} />
            </label>
            <label>Repita a senha
              <input type="password" autoComplete="new-password" minLength={8} required value={confirma} onChange={(e) => setConfirma(e.target.value)} />
            </label>
            {erro && <p role="alert" className="erro">{erro}</p>}
            <button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar e entrar'}</button>
          </form>
        )}
      </main>
    </div>
  )
}
