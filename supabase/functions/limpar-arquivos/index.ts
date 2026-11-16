// Apaga do Storage os arquivos que a rotina de retenção (LGPD) colocou na fila.
// Chamada pelo pg_cron do próprio banco; só aceita quem envia a senha guardada no cofre do banco.
import { createClient } from 'npm:@supabase/supabase-js@2'

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta({ erro: 'metodo' }, 405)
  const token = req.headers.get('x-limpeza-token') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: valido } = await admin.rpc('conferir_token_limpeza', { p_token: token })
  if (valido !== true) return resposta({ erro: 'nao_autorizado' }, 401)

  let apagados = 0
  const falhas: string[] = []
  for (let rodada = 0; rodada < 10; rodada++) {
    const { data: fila, error } = await admin.rpc('arquivos_para_apagar', { p_limite: 500 })
    if (error) return resposta({ erro: error.message, apagados }, 500)
    if (!fila?.length) break

    const porBucket = new Map<string, { id: number; caminho: string }[]>()
    for (const a of fila as { id: number; bucket: string; caminho: string }[]) {
      porBucket.set(a.bucket, [...(porBucket.get(a.bucket) ?? []), a])
    }
    const prontos: number[] = []
    for (const [bucket, itens] of porBucket) {
      const { error: e } = await admin.storage.from(bucket).remove(itens.map((i) => i.caminho))
      if (e) falhas.push(`${bucket}: ${e.message}`)
      else prontos.push(...itens.map((i) => i.id)) // arquivo que já não existia também sai da fila
    }
    if (!prontos.length) break
    await admin.rpc('confirmar_arquivos_apagados', { p_ids: prontos })
    apagados += prontos.length
  }
  return resposta({ apagados, falhas })
})
