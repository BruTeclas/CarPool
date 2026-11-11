// Cria (ou vincula) uma pessoa à empresa. Só administradores da empresa podem chamar.
// A conta nasce com senha provisória, devolvida uma única vez a quem chamou.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const PERFIS = ['motorista', 'solicitante', 'aprovador', 'gestor_base', 'gestor_frota', 'financeiro', 'admin']

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function senhaProvisoria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: autorizacao } },
  })
  const { data: quem } = await comoUsuario.auth.getUser(autorizacao.replace(/^Bearer\s+/i, ''))
  if (!quem?.user) return resposta({ erro: 'Sessão inválida. Entre novamente.' }, 401)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return resposta({ erro: 'Requisição inválida.' }, 400) }
  const empresaId = String(corpo.empresa_id ?? '')
  const email = String(corpo.email ?? '').trim().toLowerCase()
  const nome = String(corpo.nome ?? '').trim()
  const perfil = String(corpo.perfil ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(empresaId) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !nome || !PERFIS.includes(perfil)) {
    return resposta({ erro: 'Preencha nome, e-mail válido e perfil.' }, 400)
  }

  // Quem chama precisa ser admin ativo desta empresa (consulta sob a RLS do próprio usuário)
  const { data: adm } = await comoUsuario.from('membros').select('id')
    .eq('empresa_id', empresaId).eq('user_id', quem.user.id).eq('perfil', 'admin').eq('ativo', true).limit(1)
  if (!adm?.length) return resposta({ erro: 'Só administradores podem adicionar pessoas.' }, 403)

  const servico = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let userId: string | null = null
  let senha: string | null = senhaProvisoria()
  const criado = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (criado.data?.user) {
    userId = criado.data.user.id
  } else {
    // Já existe conta com esse e-mail: só vincula, sem tocar na senha dela
    senha = null
    for (let pagina = 1; pagina <= 20 && !userId; pagina++) {
      const { data } = await servico.auth.admin.listUsers({ page: pagina, perPage: 200 })
      userId = data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null
      if (!data?.users.length || data.users.length < 200) break
    }
    if (!userId) return resposta({ erro: 'Não foi possível criar a conta.' }, 500)
  }

  // Vínculo gravado como o próprio admin: a RLS confere a permissão e a auditoria registra quem fez
  const { error } = await comoUsuario.from('membros')
    .insert({ empresa_id: empresaId, user_id: userId, perfil, nome })
  if (error) {
    if (senha) await servico.auth.admin.deleteUser(userId)
    return resposta({ erro: error.code === '23505' ? 'Essa pessoa já tem esse perfil na empresa.' : 'Não foi possível vincular a pessoa.' }, 400)
  }
  return resposta({ ok: true, senha_temporaria: senha })
})
