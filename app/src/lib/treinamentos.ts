import { supabase } from './supabase'

export type TipoEtapa = 'youtube' | 'video' | 'texto' | 'pdf'
export type TipoPergunta = 'unica' | 'multipla' | 'vf' | 'escrita'

export type Treinamento = {
  id: string; empresa_id: string; familia_id: string; versao: number; titulo: string; descricao: string | null
  nota_minima: number; tentativas: number; embaralhar: boolean; publico_perfis: string[] | null; publico_grupos: string[] | null
  unidade_id: string | null; validade_meses: number | null; bloqueio: 'nenhum' | 'reservas' | 'reservas_e_retiradas'; prazo_dias: number
  publicado_em: string | null; ativo: boolean; criado_em: string
}
export type Etapa = {
  id: string; treinamento_id: string; ordem: number; tipo: TipoEtapa; titulo: string; youtube_id: string | null
  arquivo_caminho: string | null; texto: string | null; duracao_seg: number | null; tempo_minimo_seg: number
}
export type Pergunta = { id: string; treinamento_id: string; ordem: number; tipo: TipoPergunta; enunciado: string; peso: number }
export type Alternativa = { id: string; pergunta_id: string; ordem: number; texto: string; correta: boolean }

/** Etapa como o colaborador recebe: com o progresso dele */
export type EtapaDoColaborador = Etapa & { segundos: number; pendentes: number; posicao_max: number; fim_alcancado: boolean; concluida_em: string | null }
export type Matricula = { ciclo: number; conteudo_concluido_em: string | null; aprovado_em: string | null; nota: number | null; valido_ate: string | null }
export type ResumoTentativa = { id: string; numero: number; ciclo: number; nota: number | null; status: StatusTentativa; enviada_em: string | null; comentario: string | null }
export type StatusTentativa = 'em_andamento' | 'aguardando_correcao' | 'aprovada' | 'reprovada'
export type Conteudo = {
  treinamento: Treinamento; matricula: Matricula; perguntas: number; tentativas_usadas: number
  tentativas: ResumoTentativa[]; etapas: EtapaDoColaborador[]
}
export type PerguntaDaProva = { id: string; tipo: TipoPergunta; enunciado: string; peso: number; alternativas: { id: string; texto: string }[] }
export type TentativaAberta = { id: string; numero: number; perguntas: PerguntaDaProva[] }

export const TIPOS_DE_ETAPA: Record<TipoEtapa, string> = {
  youtube: 'Vídeo do YouTube',
  video: 'Vídeo enviado',
  texto: 'Texto',
  pdf: 'PDF',
}

export const TIPOS_DE_PERGUNTA: Record<TipoPergunta, string> = {
  unica: 'Múltipla escolha, uma certa',
  multipla: 'Múltipla escolha, várias certas',
  vf: 'Verdadeiro ou falso',
  escrita: 'Resposta escrita (o gestor corrige)',
}

export const SITUACAO_DA_TENTATIVA: Record<StatusTentativa, string> = {
  em_andamento: 'Em andamento',
  aguardando_correcao: 'Aguardando correção',
  aprovada: 'Aprovada',
  reprovada: 'Não aprovada',
}

/** Aceita o link inteiro (watch, youtu.be, shorts, embed) ou só o código de 11 caracteres */
export function codigoDoYoutube(texto: string): string | null {
  const t = texto.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t
  try {
    const u = new URL(t)
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12) || null
    if (u.hostname.includes('youtube')) {
      const v = u.searchParams.get('v')
      if (v) return v.slice(0, 11)
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)
      if (m) return m[1]
    }
  } catch { /* não é link */ }
  return null
}

/** 125 -> "2 min 5 s" */
export function duracao(seg: number): string {
  const s = Math.max(0, Math.round(seg))
  const m = Math.floor(s / 60)
  if (m === 0) return `${s} s`
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

/** 125 -> "2:05" */
export function relogio(seg: number): string {
  const s = Math.max(0, Math.floor(seg))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const urls = new Map<string, { url: string; ate: number }>()
export async function urlDoArquivo(caminho: string): Promise<string | null> {
  const guardado = urls.get(caminho)
  if (guardado && guardado.ate > Date.now()) return guardado.url
  const { data } = await supabase.storage.from('treinamentos').createSignedUrl(caminho, 60 * 60 * 3)
  if (!data?.signedUrl) return null
  urls.set(caminho, { url: data.signedUrl, ate: Date.now() + 60 * 60 * 2.5 * 1000 })
  return data.signedUrl
}

export async function subirArquivoDeTreinamento(empresaId: string, treinamentoId: string, arquivo: File): Promise<string> {
  const extensao = arquivo.type === 'application/pdf' ? 'pdf' : arquivo.type === 'video/webm' ? 'webm' : 'mp4'
  const caminho = `${empresaId}/${treinamentoId}/${crypto.randomUUID()}.${extensao}`
  const { error } = await supabase.storage.from('treinamentos').upload(caminho, arquivo, { contentType: arquivo.type })
  if (error) throw error
  return caminho
}

/** Duração de um vídeo enviado, lida no próprio navegador */
export function duracaoDoArquivo(arquivo: File): Promise<number | null> {
  return new Promise((ok) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(arquivo)
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); ok(Number.isFinite(v.duration) ? Math.round(v.duration) : null) }
    v.onerror = () => { URL.revokeObjectURL(url); ok(null) }
    v.src = url
  })
}

// ------------------------------------------------------------ YouTube
type YTPlayer = {
  playVideo(): void; pauseVideo(): void; seekTo(s: number, permitir: boolean): void; getCurrentTime(): number; getDuration(): number
  getPlaybackRate(): number; setPlaybackRate(r: number): void; getPlayerState(): number; destroy(): void
}
type YTNamespace = { Player: new (el: HTMLElement, opcoes: Record<string, unknown>) => YTPlayer; PlayerState: { ENDED: number; PLAYING: number; PAUSED: number } }
declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }
export type { YTPlayer }

let carregandoYoutube: Promise<YTNamespace> | null = null
export function carregarYoutube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  carregandoYoutube ??= new Promise((ok, erro) => {
    window.onYouTubeIframeAPIReady = () => ok(window.YT!)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => { carregandoYoutube = null; erro(new Error('youtube')) }
    document.head.appendChild(s)
  })
  return carregandoYoutube
}
