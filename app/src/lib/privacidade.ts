import { supabase } from './supabase'

export type AvisoPrivacidade = { id: string; empresa_id: string; versao: number; texto: string; ativo: boolean; criado_em: string }
export type Solicitacao = {
  id: string; empresa_id: string; user_id: string; tipo: 'correcao' | 'eliminacao' | 'outro'; descricao: string
  status: 'aberta' | 'atendida' | 'recusada'; resposta: string | null; respondida_em: string | null; criado_em: string
}

export const TIPOS_DE_PEDIDO: Record<Solicitacao['tipo'], string> = {
  correcao: 'Corrigir dados',
  eliminacao: 'Apagar meus dados',
  outro: 'Outra dúvida ou pedido',
}

export const SITUACOES_DE_PEDIDO: Record<Solicitacao['status'], string> = {
  aberta: 'Aguardando resposta',
  atendida: 'Atendido',
  recusada: 'Recusado',
}

/** Baixa, em JSON, tudo o que a empresa guarda sobre a própria pessoa (LGPD, art. 18). */
export async function baixarMeusDados(empresaId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('meus_dados', { p_empresa: empresaId })
  if (error || !data) return false
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `meus-dados-carpool-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
