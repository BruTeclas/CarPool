import { supabase } from './supabase'

export type FotoEnviada = {
  posicao: string
  caminho: string
  sha256: string
  tirada_em: string
  latitude: number | null
  longitude: number | null
}

export const POSICOES_SAIDA = [
  { id: 'frente', rotulo: 'Frente' },
  { id: 'traseira', rotulo: 'Traseira' },
  { id: 'lateral_esquerda', rotulo: 'Lateral esquerda' },
  { id: 'lateral_direita', rotulo: 'Lateral direita' },
  { id: 'painel', rotulo: 'Painel (odômetro e combustível)' },
]
export const POSICOES_CHEGADA = [...POSICOES_SAIDA, { id: 'vaga', rotulo: 'Carro estacionado na vaga' }]

/** Reduz a foto para no máximo `lado` px e converte em JPEG, para subir rápido com sinal fraco. */
async function reduzir(arquivo: File, lado = 1600): Promise<Blob> {
  try {
    const img = await createImageBitmap(arquivo)
    const escala = Math.min(1, lado / Math.max(img.width, img.height))
    const tela = document.createElement('canvas')
    tela.width = Math.round(img.width * escala)
    tela.height = Math.round(img.height * escala)
    tela.getContext('2d')!.drawImage(img, 0, 0, tela.width, tela.height)
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/jpeg', 0.8))
    return blob ?? arquivo
  } catch {
    return arquivo
  }
}

export async function sha256Hex(dados: Blob): Promise<string> {
  const resumo = await crypto.subtle.digest('SHA-256', await dados.arrayBuffer())
  return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Posição do aparelho, se a pessoa permitir. Nunca trava a vistoria. */
export function localizacao(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((ok) => {
    if (!('geolocation' in navigator)) return ok(null)
    const limite = setTimeout(() => ok(null), 4000)
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(limite); ok({ latitude: p.coords.latitude, longitude: p.coords.longitude }) },
      () => { clearTimeout(limite); ok(null) },
      { maximumAge: 60000, timeout: 3500 },
    )
  })
}

export async function enviarFoto(
  empresaId: string, reservaId: string, tipo: string, posicao: string, arquivo: File,
): Promise<FotoEnviada> {
  const tiradaEm = new Date().toISOString()
  const [blob, onde] = await Promise.all([reduzir(arquivo), localizacao()])
  const sha256 = await sha256Hex(blob)
  const caminho = `${empresaId}/${reservaId}/${tipo}-${posicao}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('vistorias').upload(caminho, blob, { contentType: blob.type || 'image/jpeg' })
  if (error) throw error
  return { posicao, caminho, sha256, tirada_em: tiradaEm, latitude: onde?.latitude ?? null, longitude: onde?.longitude ?? null }
}

export async function linksAssinados(caminhos: string[]): Promise<Record<string, string>> {
  if (caminhos.length === 0) return {}
  const { data } = await supabase.storage.from('vistorias').createSignedUrls(caminhos, 600)
  const mapa: Record<string, string> = {}
  for (const d of data ?? []) if (d.signedUrl && d.path) mapa[d.path] = d.signedUrl
  return mapa
}
