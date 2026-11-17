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
  podeOperar: boolean
  podeVerRelatorios: boolean
  semConexao: boolean
  /** Módulos contratados pela empresa (liberados pelo super admin) */
  modulos: Modulo[]
  suspensa: boolean
  motivoSuspensao: string | null
  /** O usuário é um super admin dentro da empresa em modo suporte */
  suporteAte: string | null
  superAdmin: boolean
}

export type Modulo = 'treinamentos' | 'relatorios' | 'documentos' | 'ocorrencias'
export const TODOS_OS_MODULOS: Modulo[] = ['treinamentos', 'relatorios', 'documentos', 'ocorrencias']

const inicial: Estado = { empresaId: null, empresaNome: '', perfis: [], carregando: true, podeGerir: false, ehAdmin: false, podeAprovar: false, podeOperar: false, podeVerRelatorios: false, semConexao: false, modulos: TODOS_OS_MODULOS, suspensa: false, motivoSuspensao: null, suporteAte: null, superAdmin: false }
const Contexto = createContext<Estado>(inicial)

type Vinculo = {
  empresa_id: string; perfil: Perfil; suporte_ate: string | null
  empresas: { nome: string; situacao: string | null; motivo_suspensao: string | null; modulos: Modulo[] | null } | null
}

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null)
  const userId = session?.user.id

  const [semConexao, setSemConexao] = useState(false)
  const [superAdmin, setSuperAdmin] = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase.rpc('sou_super_admin').then(({ data }) => setSuperAdmin(data === true))
  }, [userId])

  useEffect(() => {
    if (!userId) return
    // Guarda no aparelho os vínculos da última vez com internet: sem sinal (vistoria no subsolo,
    // estrada), o app abre com eles em vez de ficar esperando a rede.
    const chave = `carpool.vinculos.${userId}`
    let guardado: Vinculo[] | null = null
    try { guardado = JSON.parse(localStorage.getItem(chave) ?? 'null') } catch { /* sem storage */ }
    if (guardado) setVinculos(guardado)
    supabase
      .from('membros')
      .select('empresa_id, perfil, suporte_ate, empresas(nome, situacao, motivo_suspensao, modulos)')
      .eq('user_id', userId)
      .eq('ativo', true)
      .returns<Vinculo[]>()
      .then(({ data, error }) => {
        if (error || !data) {
          if (!guardado) { setSemConexao(true); setVinculos([]) }
          return
        }
        setSemConexao(false)
        // O vínculo de suporte vencido some (a rotina apaga em até 5 min); o vigente vem primeiro
        const validos = data.filter((v) => !v.suporte_ate || new Date(v.suporte_ate) > new Date())
          .sort((a, b) => Number(!!b.suporte_ate) - Number(!!a.suporte_ate))
        setVinculos(validos)
        try { localStorage.setItem(chave, JSON.stringify(data)) } catch { /* sem storage */ }
      })
  }, [userId])

  const valor = useMemo<Estado>(() => {
    if (!vinculos) return { ...inicial, superAdmin }
    const empresaId = vinculos[0]?.empresa_id ?? null
    const empresa = vinculos[0]?.empresas
    const perfis = vinculos.filter((v) => v.empresa_id === empresaId).map((v) => v.perfil)
    const ehAdmin = perfis.includes('admin')
    return {
      empresaId,
      empresaNome: vinculos[0]?.empresas?.nome ?? '',
      perfis,
      carregando: false,
      ehAdmin,
      podeGerir: ehAdmin || perfis.includes('gestor_frota'),
      podeOperar: ehAdmin || perfis.includes('gestor_frota') || perfis.includes('gestor_base'),
      podeAprovar: ehAdmin || perfis.includes('gestor_frota') || perfis.includes('aprovador'),
      podeVerRelatorios: ehAdmin || ['gestor_frota', 'gestor_base', 'financeiro'].some((p) => perfis.includes(p as Perfil)),
      semConexao,
      modulos: empresa?.modulos ?? TODOS_OS_MODULOS,
      suspensa: empresa?.situacao === 'suspensa',
      motivoSuspensao: empresa?.motivo_suspensao ?? null,
      suporteAte: vinculos[0]?.suporte_ate ?? null,
      superAdmin,
    }
  }, [vinculos, semConexao, superAdmin])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useEmpresa() {
  return useContext(Contexto)
}
