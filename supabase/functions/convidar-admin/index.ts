// Convida o administrador de uma empresa. Só super admins podem chamar.
// Conta nova: recebe o e-mail de convite e cria a própria senha em /definir-senha.
// Conta que já existe: é vinculada e recebe um e-mail para (re)definir a senha.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: autorizacao } } })
  const { data: quem } = await comoUsuario.auth.getUser(autorizacao.replace(/^Bearer\s+/i, ''))
  if (!quem?.user) return resposta({ erro: 'Sessão inválida. Entre novamente.' }, 401)
  const { data: superAdmin } = await comoUsuario.rpc('sou_super_admin')
  if (superAdmin !== true) return resposta({ erro: 'Só o super admin convida administradores.' }, 403)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return resposta({ erro: 'Requisição inválida.' }, 400) }
  const empresaId = String(corpo.empresa_id ?? '')
  const email = String(corpo.email ?? '').trim().toLowerCase()
  const nome = String(corpo.nome ?? '').trim()
  const origem = String(corpo.origem ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(empresaId) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || nome.length < 3) {
    return resposta({ erro: 'Preencha o nome e um e-mail válido.' }, 400)
  }
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origem) && !/^http:\/\/localhost(:\d+)?$/.test(origem)) {
    return resposta({ erro: 'Endereço do site inválido.' }, 400)
  }
  const destino = `${origem}/definir-senha`

  const servico = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  let userId: string | null = null
  let novo = true
  const convite = await servico.auth.admin.inviteUserByEmail(email, { redirectTo: destino, data: { nome } })
  if (convite.data?.user) {
    userId = convite.data.user.id
  } else {
    novo = false
    for (let pagina = 1; pagina <= 20 && !userId; pagina++) {
      const { data } = await servico.auth.admin.listUsers({ page: pagina, perPage: 200 })
      userId = data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null
      if (!data?.users.length || data.users.length < 200) break
    }
    if (!userId) return resposta({ erro: 'Não foi possível enviar o convite agora. Tente de novo em alguns minutos (o envio de e-mail tem limite por hora).' }, 502)
  }

  // Vínculo gravado como o próprio super admin: a auditoria registra quem fez
  const { error } = await comoUsuario.rpc('super_vincular_admin', { p_empresa: empresaId, p_user: userId, p_nome: nome })
  if (error) {
    if (novo) await servico.auth.admin.deleteUser(userId)
    const motivo = error.message.includes('limite_do_plano') ? 'A empresa atingiu o limite de usuários do plano.'
      : error.message.includes('empresa_suspensa') ? 'A empresa está suspensa.' : 'Não foi possível vincular o administrador.'
    return resposta({ erro: motivo }, 400)
  }
  if (!novo) {
    // conta já existia: manda o link para definir (ou redefinir) a senha
    await comoUsuario.auth.resetPasswordForEmail(email, { redirectTo: destino })
  }
  return resposta({ ok: true, conta_nova: novo })
})
