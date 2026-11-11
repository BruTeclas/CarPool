import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useEmpresa } from '../lib/empresa'
import { rotuloPerfil } from '../lib/perfis'
import { supabase } from '../lib/supabase'

export default function MeuPerfil() {
  const { session } = useAuth()
  const { empresaNome, perfis } = useEmpresa()
  const [senha, setSenha] = useState('')
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  async function trocarSenha(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return setMensagem({ texto: 'Não foi possível trocar a senha. Use ao menos 8 caracteres.', erro: true })
    setSenha('')
    setMensagem({ texto: 'Senha alterada.', erro: false })
  }

  return (
    <main>
      <h1>Meu perfil</h1>
      <section className="cartao">
        <p><strong>{session?.user.email}</strong></p>
        <p>{empresaNome}{perfis.length > 0 && `, como ${perfis.map(rotuloPerfil).join(', ').toLowerCase()}`}</p>
      </section>
      <section className="cartao" aria-label="Trocar senha">
        <h2>Trocar senha</h2>
        <form onSubmit={trocarSenha} className="acoes">
          <label>Nova senha
            <input type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </label>
          <button type="submit">Salvar senha</button>
        </form>
        {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
      </section>
    </main>
  )
}
