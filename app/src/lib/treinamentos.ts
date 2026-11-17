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

// ------------------------------------------------------------ obrigatoriedade e resultados
export const BLOQUEIOS: Record<Treinamento['bloqueio'], { rotulo: string; ajuda: string }> = {
  nenhum: { rotulo: 'Opcional', ajuda: 'Fica disponível para o público, mas não bloqueia nada.' },
  reservas: { rotulo: 'Obrigatório: bloqueia novas reservas', ajuda: 'Passado o prazo, quem não foi aprovado não faz reserva nova. Reservas já aprovadas continuam valendo.' },
  reservas_e_retiradas: { rotulo: 'Obrigatório: bloqueia reservas e retiradas', ajuda: 'Passado o prazo, quem não foi aprovado não reserva nem retira carro (devolver sempre pode).' },
}

export type Situacao = 'aprovado' | 'vencendo' | 'aguardando_correcao' | 'vencido' | 'atrasado' | 'em_andamento' | 'nao_iniciado'
export const SITUACOES: Record<Situacao, { rotulo: string; classe: string }> = {
  aprovado: { rotulo: 'Aprovado', classe: 's-aprovada' },
  vencendo: { rotulo: 'Vence em até 30 dias', classe: 's-solicitada' },
  aguardando_correcao: { rotulo: 'Aguardando correção', classe: 's-solicitada' },
  vencido: { rotulo: 'Vencido', classe: 's-atrasada' },
  atrasado: { rotulo: 'Prazo vencido', classe: 's-atrasada' },
  em_andamento: { rotulo: 'Em andamento', classe: 's-liberada' },
  nao_iniciado: { rotulo: 'Não iniciado', classe: '' },
}

export type LinhaAcompanhamento = {
  user_id: string; nome: string | null; situacao: Situacao; prazo_ate: string | null; etapas_concluidas: number; etapas: number
  segundos: number; tentativas: number; ultima_nota: number | null; aprovado_em: string | null; valido_ate: string | null; nota: number | null
}

export const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')

type DadosCertificado = {
  nome: string; empresa: string; treinamento: string; versao: number; nota: number; nota_minima: number
  aprovado_em: string; valido_ate: string | null; segundos: number; etapas: { titulo: string; tipo: TipoEtapa }[] | null; codigo: string | null; tentativa_id: string | null
}

/** Gera e baixa o certificado em PDF (do próprio usuário, ou de outra pessoa quando quem pede é o gestor) */
export async function baixarCertificado(treinamentoId: string, userId?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('certificado_treinamento', { p_treinamento: treinamentoId, p_user: userId ?? null })
  if (error || !data) return error?.message ?? 'erro'
  const c = data as DadosCertificado
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const L = pdf.internal.pageSize.getWidth(), A = pdf.internal.pageSize.getHeight()
  pdf.setDrawColor(0, 98, 196); pdf.setLineWidth(3); pdf.rect(28, 28, L - 56, A - 56)
  pdf.setLineWidth(0.8); pdf.rect(38, 38, L - 76, A - 76)
  const centro = (texto: string, y: number, tamanho: number, estilo: 'normal' | 'bold' = 'normal') => {
    pdf.setFont('helvetica', estilo); pdf.setFontSize(tamanho)
    for (const [i, linha] of (pdf.splitTextToSize(texto, L - 160) as string[]).entries()) pdf.text(linha, L / 2, y + i * tamanho * 1.3, { align: 'center' })
  }
  pdf.setTextColor(0, 98, 196); centro('CERTIFICADO', 110, 30, 'bold')
  pdf.setTextColor(40, 40, 40)
  centro(c.empresa, 140, 13)
  centro('Certificamos que', 195, 13)
  centro(c.nome, 228, 24, 'bold')
  centro(`concluiu o treinamento “${c.treinamento}” (versão ${c.versao}) e foi aprovado na avaliação com nota ${Number(c.nota).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} (mínimo ${c.nota_minima}).`, 268, 14)
  const etapas = c.etapas?.length ?? 0
  centro(`Tempo de estudo registrado: ${duracao(c.segundos)} · ${etapas} ${etapas === 1 ? 'etapa' : 'etapas'} de conteúdo`, 330, 11)
  centro(`Aprovado em ${dataCurta(c.aprovado_em)}${c.valido_ate ? ` · válido até ${dataCurta(c.valido_ate)}` : ''}`, 350, 11)
  pdf.setFontSize(8); pdf.setTextColor(110, 110, 115)
  centro(`Código de verificação: ${c.codigo ?? '—'}${c.tentativa_id ? ` · registro ${c.tentativa_id}` : ''}`, A - 70, 8)
  centro('O tempo de estudo foi medido pelo sistema (só conta com a tela aberta e com confirmação de presença).', A - 58, 8)
  // link próprio na página (o atalho do jsPDF perde o nome do arquivo em alguns navegadores)
  const url = URL.createObjectURL(pdf.output('blob'))
  const a = document.createElement('a')
  a.href = url
  const simples = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_')
  a.download = `certificado_${simples(c.treinamento)}_${simples(c.nome)}.pdf`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return null
}
