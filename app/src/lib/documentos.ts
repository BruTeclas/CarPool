import { sha256Hex } from './fotos'
import { supabase } from './supabase'

export type TipoDocumento = { id: string; nome: string; alvo: 'condutor' | 'veiculo'; obrigatorio: boolean; tem_validade: boolean; e_cnh: boolean; ativo: boolean }
export type Documento = {
  id: string; tipo_id: string; user_id: string | null; veiculo_id: string | null; numero: string | null; validade: string | null
  caminho: string; nome_arquivo: string | null; status: 'pendente' | 'aprovado' | 'recusado'; motivo_recusa: string | null; enviado_em: string
}
export type Assinatura = {
  id: string; termo_id: string; user_id: string; nome_assinante: string; texto_sha256: string
  assinatura_caminho: string; assinatura_sha256: string; ip: string | null; navegador: string | null; assinado_em: string
}
export type Termo = { id: string; titulo: string; texto: string; versao: number; ativo: boolean }

export const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

/** Sobe um arquivo (foto ou PDF) para a pasta da pessoa ou do veículo. Devolve o caminho. */
export async function subirArquivo(empresaId: string, alvoId: string, arquivo: Blob, nome: string): Promise<string> {
  const limpo = nome.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-60)
  const caminho = `${empresaId}/${alvoId}/${Date.now()}-${limpo}`
  const { error } = await supabase.storage.from('documentos').upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream' })
  if (error) throw error
  return caminho
}

export async function abrirArquivo(caminho: string): Promise<void> {
  const { data } = await supabase.storage.from('documentos').createSignedUrl(caminho, 300)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
}

/** Gera o PDF do termo assinado a partir do registro guardado no servidor (texto, assinatura e evidências). */
export async function baixarTermoAssinado(termo: Termo, assinatura: Assinatura, empresaNome: string): Promise<void> {
  const [{ jsPDF }, imagem] = await Promise.all([
    import('jspdf'),
    supabase.storage.from('documentos').download(assinatura.assinatura_caminho),
  ])
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const margem = 56, largura = pdf.internal.pageSize.getWidth() - margem * 2, fim = pdf.internal.pageSize.getHeight() - margem
  let y = margem
  const escrever = (texto: string, tamanho: number, estilo: 'normal' | 'bold' = 'normal', espaco = 6) => {
    pdf.setFont('helvetica', estilo); pdf.setFontSize(tamanho)
    for (const linha of pdf.splitTextToSize(texto, largura) as string[]) {
      if (y > fim) { pdf.addPage(); y = margem }
      pdf.text(linha, margem, y); y += tamanho * 1.4
    }
    y += espaco
  }
  escrever(termo.titulo, 16, 'bold')
  escrever(`${empresaNome} · versão ${termo.versao}`, 10, 'normal', 12)
  escrever(termo.texto, 11, 'normal', 18)
  if (y > fim - 190) { pdf.addPage(); y = margem }
  escrever('Assinatura', 12, 'bold', 2)
  if (imagem.data) {
    const url = await new Promise<string>((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(imagem.data) })
    pdf.addImage(url, 'PNG', margem, y, 220, 80); y += 92
  }
  escrever(assinatura.nome_assinante, 11, 'bold', 2)
  escrever(`Assinado em ${new Date(assinatura.assinado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (horário de Brasília)`, 10, 'normal', 10)
  escrever('Registro da assinatura eletrônica', 10, 'bold', 2)
  escrever([
    `Identificador: ${assinatura.id}`,
    `Resumo SHA-256 do texto assinado: ${assinatura.texto_sha256}`,
    `Resumo SHA-256 da imagem da assinatura: ${assinatura.assinatura_sha256}`,
    `Endereço IP: ${assinatura.ip ?? 'não registrado'}`,
    `Navegador: ${assinatura.navegador ?? 'não registrado'}`,
  ].join('\n'), 8)
  // confere se o texto exibido é o mesmo que foi assinado
  const confere = (await sha256Hex(termo.texto)) === assinatura.texto_sha256
  escrever(confere ? 'O texto deste documento confere com o resumo registrado no momento da assinatura.' : 'ATENÇÃO: o texto não confere com o resumo registrado na assinatura.', 8)
  pdf.save(`${termo.titulo.replace(/[^\w]+/g, '_')}_v${termo.versao}_${assinatura.nome_assinante.replace(/[^\w]+/g, '_')}.pdf`)
}
