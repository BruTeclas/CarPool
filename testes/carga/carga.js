// Teste de carga do CarPool (k6). Uso:
//   K6_SENHA=... k6 run testes/carga/carga.js
// Precisa da empresa de teste "Carga k6 (teste)" com os usuários k6.m01..m30 e k6.admin (ver README desta pasta).
import http from 'k6/http'
import { check, sleep } from 'k6'
import exec from 'k6/execution'
import { Counter, Trend } from 'k6/metrics'

const SUPABASE = __ENV.SUPABASE_URL || 'https://lsqssnerbocisxmhxfag.supabase.co'
const CHAVE = __ENV.SUPABASE_KEY || 'sb_publishable_fz95R1Liud98gRhL743b6Q_DQvxeJMe' // publicável (pública por desenho)
const SITE = __ENV.SITE_URL || 'https://carpool-7iv.pages.dev'
const EMPRESA = 'cccccccc-0000-4000-8000-000000000001'
const SENHA = __ENV.K6_SENHA
const MOTORISTAS = 30

const errosPorCodigo = new Counter('erros_por_codigo')
const corridaSucesso = new Counter('corrida_sucesso')
const corridaConflito = new Counter('corrida_conflito')
const reservasCriadas = new Counter('reservas_criadas')
const tempoReserva = new Trend('tempo_criar_reserva', true)

const TODOS_OS_CENARIOS = {
    site: { executor: 'constant-arrival-rate', exec: 'site', rate: 5, timeUnit: '1s', duration: '4m', preAllocatedVUs: 10, maxVUs: 30 },
    leitura: {
      executor: 'ramping-vus', exec: 'leitura', startVUs: 0,
      stages: [{ duration: '1m', target: 30 }, { duration: '2m', target: 30 }, { duration: '30s', target: 0 }],
    },
    reserva: {
      executor: 'ramping-vus', exec: 'reservar', startVUs: 0, startTime: '15s',
      stages: [{ duration: '45s', target: 10 }, { duration: '2m', target: 10 }, { duration: '30s', target: 0 }],
    },
    corrida: { executor: 'per-vu-iterations', exec: 'corrida', vus: MOTORISTAS, iterations: 1, startTime: '1m45s', maxDuration: '1m' },
    // estresse: só roda quando pedido (CENARIOS=estresse); procura o ponto em que o sistema começa a falhar
    estresse: {
      executor: 'ramping-vus', exec: 'leitura', startVUs: 0,
      stages: [{ duration: '1m', target: 50 }, { duration: '1m', target: 100 }, { duration: '1m30s', target: 100 }, { duration: '30s', target: 0 }],
    },
}
// CENARIOS=corrida roda só os escolhidos (separados por vírgula), sem esperar o início programado
const escolhidos = __ENV.CENARIOS ? __ENV.CENARIOS.split(',') : Object.keys(TODOS_OS_CENARIOS).filter((n) => n !== 'estresse')
const cenarios = Object.fromEntries(escolhidos.map((n) => [n, __ENV.CENARIOS ? { ...TODOS_OS_CENARIOS[n], startTime: '0s' } : TODOS_OS_CENARIOS[n]]))

export const options = {
  setupTimeout: '3m',
  scenarios: cenarios,
  thresholds: {
    'http_req_failed{grupo:site}': ['rate<0.01'],
    'http_req_duration{grupo:site}': ['p(95)<800'],
    'http_req_failed{grupo:leitura}': ['rate<0.01'],
    'http_req_duration{grupo:leitura}': ['p(95)<1000'],
    'http_req_failed{grupo:reserva}': ['rate<0.01'],
    tempo_criar_reserva: ['p(95)<1500'],
    ...(escolhidos.includes('corrida') ? { corrida_sucesso: ['count==1'] } : {}),
    checks: ['rate>0.99'],
  },
}

// ------------------------------------------------------------ apoio
function cabecalhos(token) {
  return { headers: { apikey: CHAVE, Authorization: `Bearer ${token || CHAVE}`, 'Content-Type': 'application/json' } }
}
function codigoDoErro(res) {
  try { const j = res.json(); return (j.message || j.msg || j.error_description || j.error || `http_${res.status}`).split(':')[0] } catch { return `http_${res.status}` }
}
function registrarErro(res, onde) {
  if (res.status >= 400 || res.status === 0) errosPorCodigo.add(1, { onde, codigo: res.status === 0 ? 'sem_resposta' : codigoDoErro(res), status: String(res.status) })
}
function rpc(token, fn, corpo, grupo) {
  const res = http.post(`${SUPABASE}/rest/v1/rpc/${fn}`, JSON.stringify(corpo || {}), { ...cabecalhos(token), tags: { grupo, name: `rpc/${fn}` } })
  return res
}
function rest(token, caminho, grupo, nome) {
  return http.get(`${SUPABASE}/rest/v1/${caminho}`, { ...cabecalhos(token), tags: { grupo, name: nome } })
}
const isoDaqui = (horas) => new Date(Date.now() + horas * 3600e3).toISOString()

// ------------------------------------------------------------ preparo: entra com cada usuário uma vez
export function setup() {
  if (!SENHA) throw new Error('Defina K6_SENHA')
  const entrar = (email) => {
    const res = http.post(`${SUPABASE}/auth/v1/token?grant_type=password`, JSON.stringify({ email, password: SENHA }), { ...cabecalhos(), tags: { grupo: 'login', name: 'auth/token' } })
    registrarErro(res, 'login')
    check(res, { 'login ok': (r) => r.status === 200 })
    return res.status === 200 ? res.json() : null
  }
  const motoristas = []
  for (let i = 1; i <= MOTORISTAS; i++) {
    const s = entrar(`k6.m${String(i).padStart(2, '0')}@carpool.test`)
    if (s) motoristas.push({ token: s.access_token, id: s.user.id })
    sleep(0.3)
  }
  const admin = entrar('k6.admin@carpool.test')
  const veiculos = rest(admin.access_token, `veiculos?select=id,placa,categoria_id,base_id&empresa_id=eq.${EMPRESA}&order=placa`, 'setup', 'veiculos').json()
  // um recurso estático do site para medir o carregamento completo
  const html = http.get(`${SITE}/`, { tags: { grupo: 'setup' } }).body
  const m = /src="(\/assets\/[^"]+\.js)"/.exec(html)
  console.log(`preparo: ${motoristas.length} motoristas, ${veiculos.length} veículos, recurso ${m ? m[1] : 'não achado'}`)
  return { motoristas, admin: { token: admin.access_token, id: admin.user.id }, veiculos, recurso: m ? m[1] : null }
}

// ------------------------------------------------------------ cenários
export function site(d) {
  const r1 = http.get(`${SITE}/`, { tags: { grupo: 'site', name: 'site /' } })
  const r2 = http.get(`${SITE}/entrar`, { tags: { grupo: 'site', name: 'site /entrar' } })
  check(r1, { 'site / 200': (r) => r.status === 200 }); check(r2, { 'site /entrar 200': (r) => r.status === 200 })
  registrarErro(r1, 'site'); registrarErro(r2, 'site')
  if (d.recurso) { const r3 = http.get(`${SITE}${d.recurso}`, { tags: { grupo: 'site', name: 'site recurso js' } }); check(r3, { 'site js 200': (r) => r.status === 200 }); registrarErro(r3, 'site') }
}

export function leitura(d) {
  const m = d.motoristas[(exec.vu.idInTest) % d.motoristas.length]
  const passos = [
    ['vinculos', () => rest(m.token, `membros?select=empresa_id,perfil,suporte_ate,empresas(nome,situacao,modulos)&user_id=eq.${m.id}&ativo=eq.true`, 'leitura', 'membros (início do app)')],
    ['pendencias', () => rpc(m.token, 'pendencias_para_reservar', { p_empresa: EMPRESA }, 'leitura')],
    ['disponibilidade', () => rpc(m.token, 'disponibilidade', { p_inicio: isoDaqui(30), p_fim: isoDaqui(32), p_categoria: null, p_base: null }, 'leitura')],
    ['minhas reservas', () => rest(m.token, `reservas?select=id,inicio,fim,status,veiculos(placa,modelo)&motorista_id=eq.${m.id}&order=inicio.desc&limit=50`, 'leitura', 'reservas (minhas)')],
    ['avisos', () => rest(m.token, `notificacoes?select=id&user_id=eq.${m.id}&lida_em=is.null`, 'leitura', 'notificacoes (contador)')],
    ['comunicados', () => rpc(m.token, 'comunicados_pendentes', { p_empresa: EMPRESA }, 'leitura')],
    ['treinamentos', () => rpc(m.token, 'meus_treinamentos', { p_empresa: EMPRESA }, 'leitura')],
    ['privacidade', () => rpc(m.token, 'aviso_privacidade_pendente', { p_empresa: EMPRESA }, 'leitura')],
  ]
  for (const [nome, fazer] of passos) {
    const res = fazer()
    check(res, { [`leitura ${nome} ok`]: (r) => r.status === 200 })
    registrarErro(res, `leitura ${nome}`)
  }
  sleep(1 + Math.random() * 2)
}

export function reservar(d) {
  const n = exec.scenario.iterationInTest
  const m = d.motoristas[n % d.motoristas.length]
  const v = d.veiculos[n % d.veiculos.length]
  // cada carro recebe horários de 1 h espaçados de 2 h, a partir de 5 dias (longe da janela de cancelamento)
  const inicio = 24 * 5 + Math.floor(n / d.veiculos.length) * 2
  const t0 = Date.now()
  const res = rpc(m.token, 'criar_reserva', { p_veiculo: v.id, p_inicio: isoDaqui(inicio), p_fim: isoDaqui(inicio + 1), p_finalidade: 'teste de carga', p_destino: 'k6' }, 'reserva')
  tempoReserva.add(Date.now() - t0)
  const ok = check(res, { 'reserva criada': (r) => r.status === 200 })
  registrarErro(res, 'criar_reserva')
  if (ok) {
    reservasCriadas.add(1)
    const id = res.json().id
    sleep(0.5)
    const c = rpc(m.token, 'transicionar_reserva', { p_reserva: id, p_para: 'cancelada', p_detalhe: { motivo: 'teste de carga' } }, 'reserva')
    check(c, { 'reserva cancelada': (r) => r.status === 200 })
    registrarErro(c, 'cancelar_reserva')
  }
  sleep(1)
}

export function corrida(d) {
  // todos ao mesmo tempo: mesmo carro, mesmo horário (10 dias à frente). Só um pode conseguir.
  const m = d.motoristas[exec.scenario.iterationInTest % d.motoristas.length]
  const v = d.veiculos[0]
  const base = new Date(); base.setUTCHours(13, 0, 0, 0)
  const inicio = new Date(base.getTime() + 10 * 86400e3).toISOString()
  const fim = new Date(base.getTime() + 10 * 86400e3 + 3600e3).toISOString()
  const res = rpc(m.token, 'criar_reserva', { p_veiculo: v.id, p_inicio: inicio, p_fim: fim, p_finalidade: 'corrida', p_destino: 'k6' }, 'corrida')
  if (res.status === 200) corridaSucesso.add(1)
  else if (codigoDoErro(res) === 'conflito_agenda') corridaConflito.add(1)
  else registrarErro(res, 'corrida')
  check(res, { 'corrida: sucesso ou conflito de agenda': (r) => r.status === 200 || codigoDoErro(r) === 'conflito_agenda' })
}

export function teardown(d) {
  // confere no banco que só existe UMA reserva ativa no horário disputado
  const r = rest(d.admin.token, `reservas?select=id,status&veiculo_id=eq.${d.veiculos[0].id}&finalidade=eq.corrida&status=neq.cancelada`, 'setup', 'conferencia corrida')
  console.log(`corrida: reservas ativas no horário disputado = ${r.json().length}`)
}

export function handleSummary(dados) {
  return {
    [__ENV.RESUMO || 'resumo-carga.json']: JSON.stringify(dados, null, 2),
    stdout: textoDoResumo(dados),
  }
}

function textoDoResumo(d) {
  const m = d.metrics, linhas = ['', '=== RESUMO DO TESTE DE CARGA ===']
  const ms = (x) => (x === undefined ? '-' : `${Math.round(x)} ms`)
  for (const [nome, met] of Object.entries(m)) {
    if (met.thresholds) for (const [regra, r] of Object.entries(met.thresholds)) linhas.push(`${r.ok ? 'OK   ' : 'FALHA'} ${nome} ${regra}`)
  }
  linhas.push(`requisições: ${m.http_reqs?.values.count}  falhas: ${((m.http_req_failed?.values.rate || 0) * 100).toFixed(2)}%  p95 geral: ${ms(m.http_req_duration?.values['p(95)'])}`)
  linhas.push(`reservas criadas: ${m.reservas_criadas?.values.count || 0}  corrida: sucesso ${m.corrida_sucesso?.values.count || 0}, conflito ${m.corrida_conflito?.values.count || 0}`)
  return linhas.join('\n') + '\n'
}
