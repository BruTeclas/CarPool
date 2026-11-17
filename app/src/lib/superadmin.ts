import type { Modulo } from './empresa'

export type EmpresaResumo = {
  id: string; nome: string; razao_social: string | null; cnpj: string | null; situacao: 'ativa' | 'suspensa'
  suspensa_em: string | null; motivo_suspensao: string | null; modulos: Modulo[]
  limite_usuarios: number | null; limite_veiculos: number | null; limite_filiais: number | null; criado_em: string
  usuarios: number; admins: number; veiculos: number; filiais: number; reservas_30d: number; ultimo_acesso: string | null
}

export const MODULOS: { valor: Modulo; rotulo: string; ajuda: string }[] = [
  { valor: 'treinamentos', rotulo: 'Treinamentos e comunicados', ajuda: 'Cursos com prova, bloqueio por treinamento e comunicados em pop-up.' },
  { valor: 'relatorios', rotulo: 'Relatórios e central da portaria', ajuda: 'Indicadores da frota, planilhas e a tela de TV da portaria.' },
  { valor: 'documentos', rotulo: 'Documentos e termos', ajuda: 'Documentos com validade (motorista e veículo) e termo de uso assinado.' },
  { valor: 'ocorrencias', rotulo: 'Ocorrências (pane e acidente)', ajuda: 'Botão de emergência, assistência e troca de veículo.' },
]

/** 12345678000195 -> 12.345.678/0001-95 */
export function formatarCnpj(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c ?? '')
}

/** Confere os dígitos verificadores do CNPJ (o banco confere de novo) */
export function cnpjValido(c: string): boolean {
  const d = c.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

export const limiteTexto = (qtd: number, limite: number | null) => (limite ? `${qtd} de ${limite}` : String(qtd))
