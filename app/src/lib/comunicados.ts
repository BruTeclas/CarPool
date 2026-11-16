import { supabase } from './supabase'

export type Nivel = 'informativo' | 'ciencia' | 'bloqueante'
export type Recorrencia = 'unica' | 'diaria' | 'semanal' | 'mensal' | 'anual' | 'ate_confirmar'

export type Comunicado = {
  id: string; empresa_id: string; titulo: string; texto: string | null; imagem_caminho: string | null
  acao_rotulo: string | null; acao_link: string | null; unidade_id: string | null
  nivel: Nivel; recorrencia: Recorrencia; inicio: string; fim: string | null; janela_dias: number | null
  encerrado_em: string | null; criado_em: string
}
/** Como chega ao colaborador: o comunicado mais a situação dele na repetição em vigor */
export type ComunicadoMeu = Comunicado & { ocorrencia: string; visto_em: string | null; ciente_em?: string | null; pendente?: boolean }
/** Como o gestor vê na lista */
export type ComunicadoGestor = Comunicado & { publico_perfis: string[] | null; publico_grupos: string[] | null }

export const NIVEIS: Record<Nivel, { rotulo: string; ajuda: string }> = {
  informativo: { rotulo: 'Informativo', ajuda: 'Aparece e a pessoa fecha. O sistema registra quem viu.' },
  ciencia: { rotulo: 'Ciência obrigatória', ajuda: 'Pede “Li e entendi”, registrado com data e hora.' },
  bloqueante: { rotulo: 'Bloqueante', ajuda: 'A pessoa não reserva veículo até dar ciência. Para avisos críticos, como recall.' },
}

export const RECORRENCIAS: Record<Recorrencia, string> = {
  unica: 'Uma vez só',
  diaria: 'Todo dia',
  semanal: 'Toda semana',
  mensal: 'Todo mês',
  anual: 'Todo ano na mesma época',
  ate_confirmar: 'A cada acesso, até confirmar',
}

/** Precisa de “Li e entendi” para sair da lista de pendentes */
export const pedeCiencia = (c: Pick<Comunicado, 'nivel'>) => c.nivel !== 'informativo'

const urls = new Map<string, string>()
export async function urlDaImagem(caminho: string): Promise<string | null> {
  if (urls.has(caminho)) return urls.get(caminho)!
  const { data } = await supabase.storage.from('comunicados').createSignedUrl(caminho, 60 * 60)
  if (data?.signedUrl) urls.set(caminho, data.signedUrl)
  return data?.signedUrl ?? null
}

/** Reduz a imagem para no máximo 1600 px no maior lado, em WebP (abre rápido no celular). */
export async function prepararImagem(arquivo: File, lado = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error('imagem'))), 'image/webp', 0.85))
}

export async function marcarComunicado(id: string, ciente: boolean) {
  return supabase.rpc('marcar_comunicado', { p_comunicado: id, p_ciente: ciente })
}
