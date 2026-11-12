import { supabase } from './supabase'

export type FotoEnviada = {
  posicao: string
  caminho: string
  sha256: string
  tirada_em: string
  latitude: number | null
  longitude: number | null
}
/** Foto já reduzida e com resumo calculado, ainda no aparelho. */
export type FotoPreparada = Omit<FotoEnviada, 'caminho'> & { blob: Blob }
export type FotoDaVistoria = FotoEnviada | FotoPreparada

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

export async function sha256Hex(dados: Blob | string): Promise<string> {
  const bytes = typeof dados === 'string' ? new TextEncoder().encode(dados) : await dados.arrayBuffer()
  const resumo = await crypto.subtle.digest('SHA-256', bytes)
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

/** Prepara a foto no aparelho: reduz, calcula o SHA-256 e registra hora e local do momento da captura. */
export async function prepararFoto(posicao: string, arquivo: File): Promise<FotoPreparada> {
  const tiradaEm = new Date().toISOString()
  const [blob, onde] = await Promise.all([reduzir(arquivo), localizacao()])
  return { posicao, blob, sha256: await sha256Hex(blob), tirada_em: tiradaEm, latitude: onde?.latitude ?? null, longitude: onde?.longitude ?? null }
}

export async function subirFoto(empresaId: string, reservaId: string, tipo: string, foto: FotoPreparada): Promise<FotoEnviada> {
  const caminho = `${empresaId}/${reservaId}/${tipo}-${foto.posicao}-${foto.sha256.slice(0, 12)}.jpg`
  const { error } = await supabase.storage.from('vistorias').upload(caminho, foto.blob, { contentType: foto.blob.type || 'image/jpeg', upsert: false })
  // "já existe" significa que essa mesma foto subiu numa tentativa anterior
  if (error && !/exists|duplicate/i.test(error.message)) throw error
  return { posicao: foto.posicao, caminho, sha256: foto.sha256, tirada_em: foto.tirada_em, latitude: foto.latitude, longitude: foto.longitude }
}

export async function linksAssinados(caminhos: string[]): Promise<Record<string, string>> {
  if (caminhos.length === 0) return {}
  const { data } = await supabase.storage.from('vistorias').createSignedUrls(caminhos, 600)
  const mapa: Record<string, string> = {}
  for (const d of data ?? []) if (d.signedUrl && d.path) mapa[d.path] = d.signedUrl
  return mapa
}
