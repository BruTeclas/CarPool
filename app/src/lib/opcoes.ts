import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Opcao = { valor: string; rotulo: string }

/** Carrega opções (id + rótulo) de uma tabela da empresa. `versao` força recarregar. */
export function useOpcoes(tabela: string, colunaValor: string, colunaRotulo: string, empresaId: string | null, versao = 0): Opcao[] {
  const [opcoes, setOpcoes] = useState<Opcao[]>([])
  useEffect(() => {
    if (!empresaId) return
    supabase
      .from(tabela)
      .select(`${colunaValor}, ${colunaRotulo}`)
      .eq('empresa_id', empresaId)
      .order(colunaRotulo)
      .then(({ data }) => {
        const vistos = new Set<string>()
        const lista: Opcao[] = []
        for (const l of (data ?? []) as unknown as Record<string, string>[]) {
          if (vistos.has(l[colunaValor])) continue
          vistos.add(l[colunaValor])
          lista.push({ valor: l[colunaValor], rotulo: l[colunaRotulo] })
        }
        setOpcoes(lista)
      })
  }, [tabela, colunaValor, colunaRotulo, empresaId, versao])
  return opcoes
}
