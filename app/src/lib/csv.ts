/** CSV no formato que o Excel em português abre direto: ponto e vírgula, vírgula decimal e BOM UTF-8. */
export type Coluna<T> = { titulo: string; valor: (linha: T) => string | number | boolean | null | undefined }

function celula(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ''
  const texto = typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : v
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function gerarCsv<T>(linhas: T[], colunas: Coluna<T>[]): string {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(';')
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(';'))
  return '﻿' + [cabecalho, ...corpo].join('\r\n') + '\r\n'
}

export function baixarCsv(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
