const ROTULOS: Record<string, string> = {
  solicitada: 'Aguardando aprovação',
  aprovada: 'Confirmada',
  liberada: 'Chave liberada',
  em_uso: 'Em uso',
  atrasada: 'Atrasada',
  devolvida: 'Devolvida',
  encerrada: 'Encerrada',
  no_show: 'Não retirada',
  cancelada: 'Cancelada',
  recusada: 'Recusada',
}
export const rotuloStatus = (s: string) => ROTULOS[s] ?? s
export const podeCancelar = (s: string) => s === 'solicitada' || s === 'aprovada'
