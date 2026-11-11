import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { Perfil } from './perfis'
import { supabase } from './supabase'

type Estado = {
  empresaId: string | null
  empresaNome: string
  perfis: Perfil[]
  carregando: boolean
  podeGerir: boolean
  ehAdmin: boolean
  podeAprovar: boolean
}

const inicial: Estado = { empresaId: null, empresaNome: '', perfis: [], carregando: true, podeGerir: false, ehAdmin: false, podeAprovar: false }
const Contexto = createContext<Estado>(inicial)

type Vinculo = { empresa_id: string; perfil: Perfil; empresas: { nome: string } | null }

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null)
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) return
    supabase
      .from('membros')
      .select('empresa_id, perfil, empresas(nome)')
      .eq('user_id', userId)
      .eq('ativo', true)
      .returns<Vinculo[]>()
      .then(({ data }) => setVinculos(data ?? []))
  }, [userId])

  const valor = useMemo<Estado>(() => {
    if (!vinculos) return inicial
    const empresaId = vinculos[0]?.empresa_id ?? null
    const perfis = vinculos.filter((v) => v.empresa_id === empresaId).map((v) => v.perfil)
    const ehAdmin = perfis.includes('admin')
    return {
      empresaId,
      empresaNome: vinculos[0]?.empresas?.nome ?? '',
      perfis,
      carregando: false,
      ehAdmin,
      podeGerir: ehAdmin || perfis.includes('gestor_frota'),
      podeAprovar: ehAdmin || perfis.includes('gestor_frota') || perfis.includes('aprovador'),
    }
  }, [vinculos])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useEmpresa() {
  return useContext(Contexto)
}
