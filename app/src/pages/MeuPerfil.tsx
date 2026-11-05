import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { rotuloPerfil } from '../lib/perfis'
import type { Perfil } from '../lib/perfis'

type Vinculo = { id: string; perfil: Perfil; nome: string; empresas: { nome: string } | null }

export default function MeuPerfil() {
  const { session } = useAuth()
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('membros')
      .select('id, perfil, nome, empresas(nome)')
      .eq('user_id', session?.user.id ?? '')
      .returns<Vinculo[]>()
      .then(({ data, error }) => {
        if (error) setErro('Não foi possível carregar seu perfil.')
        else setVinculos(data ?? [])
      })
  }, [session?.user.id])

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <h1>Meu perfil</h1>
      <p>{session?.user.email}</p>
      {erro && <p role="alert">{erro}</p>}
      <ul>
        {vinculos.map((v) => (
          <li key={v.id}>{v.nome} · {rotuloPerfil(v.perfil)} · {v.empresas?.nome}</li>
        ))}
      </ul>
      <button onClick={() => supabase.auth.signOut()}>Sair</button>
    </main>
  )
}
