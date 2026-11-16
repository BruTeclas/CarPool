import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { dataBr } from '../lib/documentos'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { SITUACOES_DE_PEDIDO, TIPOS_DE_PEDIDO } from '../lib/privacidade'
import type { AvisoPrivacidade, Solicitacao } from '../lib/privacidade'
import { supabase } from '../lib/supabase'

type Mensagem = { texto: string; erro: boolean } | null
type Membro = { user_id: string; nome: string | null; ativo: boolean; perfil: string; inativado_em: string | null }
type Prazos = {
  retencao_localizacao_dias: number; retencao_fotos_dias: number; retencao_documentos_dias: number
  retencao_inativos_dias: number; retencao_avisos_dias: number; retencao_auditoria_dias: number; encarregado_contato: string | null
}

const PRAZOS: { campo: keyof Omit<Prazos, 'encarregado_contato'>; rotulo: string; min: number; ajuda: string }[] = [
  { campo: 'retencao_localizacao_dias', rotulo: 'Localização (GPS)', min: 30, ajuda: 'Coordenadas das fotos e das ocorrências.' },
  { campo: 'retencao_fotos_dias', rotulo: 'Fotos das vistorias', min: 90, ajuda: 'Servem de prova em caso de avaria ou multa.' },
  { campo: 'retencao_documentos_dias', rotulo: 'Documentos substituídos ou recusados', min: 30, ajuda: 'O documento em vigor fica enquanto valer.' },
  { campo: 'retencao_inativos_dias', rotulo: 'Pessoas desligadas', min: 30, ajuda: 'Depois disso, nome e documentos são removidos.' },
  { campo: 'retencao_avisos_dias', rotulo: 'Avisos já lidos', min: 7, ajuda: 'Notificações dentro do sistema.' },
  { campo: 'retencao_auditoria_dias', rotulo: 'Registro de auditoria', min: 365, ajuda: 'Quem mudou o quê. Mínimo de 1 ano.' },
]

const MODELO = `Este aviso explica como os seus dados pessoais são tratados no sistema de reserva de veículos da empresa.

Quais dados: nome, e-mail, dados da CNH e documentos enviados, reservas, vistorias com fotos, odômetro e combustível, localização no momento das fotos e das ocorrências, e registros de uso.

Para quê: gerir o uso dos veículos da frota, comprovar o estado do carro na retirada e na devolução, apurar avarias, multas e acidentes, e cumprir obrigações legais. A base legal é a execução do contrato de trabalho, o cumprimento de obrigação legal e o legítimo interesse da empresa (LGPD, art. 7º).

Quem vê: os gestores da frota e da portaria da sua unidade e, quando necessário, seguradora, oficina e autoridades de trânsito.

Por quanto tempo: a localização é apagada em 180 dias, as fotos em 2 anos e os documentos substituídos em 1 ano. Ao sair da empresa, seus dados são removidos após 1 ano; o histórico de uso dos veículos é mantido sem o seu nome.

Seus direitos: em Meu perfil você baixa uma cópia dos seus dados, corrige seu nome e pede correção ou exclusão.`

function Retorno({ m }: { m: Mensagem | undefined }) {
  return m ? <p role={m.erro ? 'alert' : 'status'} className={m.erro ? 'erro' : 'sucesso'}>{m.texto}</p> : null
}

export default function Privacidade() {
  const { session } = useAuth()
  const { empresaId, ehAdmin } = useEmpresa()
  const [avisos, setAvisos] = useState<AvisoPrivacidade[]>([])
  const [ciencias, setCiencias] = useState<{ aviso_id: string }[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [pedidos, setPedidos] = useState<Solicitacao[]>([])
  const [prazos, setPrazos] = useState<Prazos | null>(null)
  const [texto, setTexto] = useState('')
  const [respostas, setRespostas] = useState<Record<string, string>>({})
  const [pessoa, setPessoa] = useState('')
  const [motivo, setMotivo] = useState('')
  const [msg, setMsg] = useState<Record<string, Mensagem>>({})
  const aviso = (chave: string, m: Mensagem) => setMsg((x) => ({ ...x, [chave]: m }))

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const [a, c, m, s, e] = await Promise.all([
      supabase.from('avisos_privacidade').select('*').eq('empresa_id', empresaId).order('versao', { ascending: false }).returns<AvisoPrivacidade[]>(),
      supabase.from('ciencias_privacidade').select('aviso_id').eq('empresa_id', empresaId).returns<{ aviso_id: string }[]>(),
      supabase.from('membros').select('user_id, nome, ativo, perfil, inativado_em').eq('empresa_id', empresaId).order('nome').returns<Membro[]>(),
      supabase.from('solicitacoes_titular').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).returns<Solicitacao[]>(),
      supabase.from('empresas').select('retencao_localizacao_dias, retencao_fotos_dias, retencao_documentos_dias, retencao_inativos_dias, retencao_avisos_dias, retencao_auditoria_dias, encarregado_contato')
        .eq('id', empresaId).maybeSingle<Prazos>(),
    ])
    setAvisos(a.data ?? [])
    setCiencias(c.data ?? [])
    setMembros(m.data ?? [])
    setPedidos(s.data ?? [])
    setPrazos(e.data ?? null)
    setTexto((t) => t || (a.data?.[0]?.texto ?? MODELO))
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  // Uma pessoa pode ter mais de um perfil: uma linha por pessoa
  const pessoas = [...new Map(membros.map((m) => [m.user_id, m])).values()]
  const nomeDe = (id: string) => pessoas.find((p) => p.user_id === id)?.nome ?? 'Pessoa'
  const ativos = pessoas.filter((p) => p.ativo).length
  const vigente = avisos.find((a) => a.ativo)

  async function publicar(e: FormEvent) {
    e.preventDefault()
    aviso('aviso', null)
    const { data: atuais } = await supabase.from('avisos_privacidade').select('id, versao, ativo').eq('empresa_id', empresaId ?? '')
      .returns<Pick<AvisoPrivacidade, 'id' | 'versao' | 'ativo'>[]>()
    const versao = Math.max(0, ...(atuais ?? []).map((x) => x.versao)) + 1
    const { data: novo, error } = await supabase.from('avisos_privacidade')
      .insert({ empresa_id: empresaId, versao, texto: texto.trim(), criado_por: session?.user.id }).select('id').single()
    if (error) return aviso('aviso', { texto: 'Não foi possível publicar o aviso.', erro: true })
    const antigos = (atuais ?? []).filter((x) => x.ativo).map((x) => x.id)
    if (antigos.length) await supabase.from('avisos_privacidade').update({ ativo: false }).in('id', antigos)
    // Quem publicou já leu: registra a própria ciência
    await supabase.rpc('dar_ciencia_privacidade', { p_aviso: novo.id })
    await carregar()
    aviso('aviso', { texto: `Versão ${versao} publicada. Cada pessoa verá o aviso no próximo acesso.`, erro: false })
  }

  async function responder(p: Solicitacao, status: 'atendida' | 'recusada') {
    aviso(p.id, null)
    const { error } = await supabase.rpc('responder_solicitacao', { p_solicitacao: p.id, p_status: status, p_resposta: respostas[p.id] ?? '' })
    if (error) return aviso(p.id, { texto: mensagemDeErro(error), erro: true })
    await carregar()
  }

  async function salvarPrazos(e: FormEvent) {
    e.preventDefault()
    if (!prazos) return
    aviso('prazos', null)
    const { error } = await supabase.from('empresas')
      .update({ ...prazos, encarregado_contato: prazos.encarregado_contato?.trim() || null }).eq('id', empresaId ?? '')
    if (!error) await carregar()
    aviso('prazos', error ? { texto: 'Não foi possível salvar. Confira os valores mínimos de cada prazo.', erro: true } : { texto: 'Prazos salvos. A limpeza roda todo dia de madrugada.', erro: false })
  }

  async function anonimizar(e: FormEvent) {
    e.preventDefault()
    aviso('anon', null)
    const alvo = pessoas.find((p) => p.user_id === pessoa)
    if (!alvo || !window.confirm(`Remover os dados pessoais de ${alvo.nome ?? 'esta pessoa'}? O acesso dela é encerrado e isso não pode ser desfeito.`)) return
    const { error } = await supabase.rpc('anonimizar_pessoa', { p_empresa: empresaId, p_user: pessoa, p_motivo: motivo })
    if (error) return aviso('anon', { texto: mensagemDeErro(error), erro: true })
    setPessoa('')
    setMotivo('')
    await carregar()
    aviso('anon', { texto: 'Dados removidos. O histórico de uso dos veículos continua, sem o nome.', erro: false })
  }

  if (!ehAdmin) return <main><p role="alert" className="erro">Só o administrador acessa esta página.</p></main>

  const abertos = pedidos.filter((p) => p.status === 'aberta')
  const respondidos = pedidos.filter((p) => p.status !== 'aberta')
  const removiveis = pessoas.filter((p) => p.user_id !== session?.user.id && p.nome !== 'Pessoa removida')
    .sort((a, b) => Number(a.ativo) - Number(b.ativo))

  return (
    <main>
      <h1>Privacidade e dados</h1>
      <p>O que a LGPD pede do sistema: avisar as pessoas sobre o uso dos dados, responder aos pedidos delas e não guardar nada além do necessário.</p>

      <section className="cartao" aria-label="Pedidos das pessoas">
        <h2>Pedidos das pessoas {abertos.length > 0 && <span className="contador urgente">{abertos.length}</span>}</h2>
        <p>A LGPD dá até 15 dias para responder. A resposta chega à pessoa em Avisos.</p>
        {abertos.length === 0 && <p>Nenhum pedido aguardando resposta.</p>}
        {abertos.map((p) => (
          <div key={p.id} className="doc-linha">
            <div className="doc-topo">
              <strong>{nomeDe(p.user_id)}: {TIPOS_DE_PEDIDO[p.tipo]}</strong>
              <span>Recebido em {dataBr(p.criado_em)}</span>
            </div>
            <p>{p.descricao}</p>
            <label>Resposta
              <textarea rows={2} value={respostas[p.id] ?? ''} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} />
            </label>
            <div className="acoes">
              <button type="button" onClick={() => responder(p, 'atendida')}>Marcar como atendido</button>
              <button type="button" className="secundario" onClick={() => responder(p, 'recusada')}>Recusar</button>
            </div>
            <Retorno m={msg[p.id]} />
          </div>
        ))}
        {respondidos.length > 0 && (
          <details>
            <summary>Pedidos respondidos ({respondidos.length})</summary>
            <ul>
              {respondidos.map((p) => (
                <li key={p.id}>{nomeDe(p.user_id)}, {TIPOS_DE_PEDIDO[p.tipo].toLowerCase()}, {dataBr(p.criado_em)}: {SITUACOES_DE_PEDIDO[p.status].toLowerCase()} em {dataBr(p.respondida_em)}. {p.resposta}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="cartao" aria-label="Aviso de privacidade">
        <h2>Aviso de privacidade</h2>
        {vigente
          ? <p>Versão {vigente.versao} em vigor desde {dataBr(vigente.criado_em)}. Ciência de {ciencias.filter((c) => c.aviso_id === vigente.id).length} de {ativos} pessoas ativas.</p>
          : <p>Nenhum aviso publicado. Publique um para que cada pessoa o leia no próximo acesso. O texto abaixo é um modelo: ajuste à sua empresa.</p>}
        <form onSubmit={publicar} style={{ display: 'grid', gap: 14 }}>
          <label>Texto do aviso
            <textarea required rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          <div className="acoes"><button type="submit">{vigente ? 'Publicar nova versão' : 'Publicar aviso'}</button></div>
        </form>
        <Retorno m={msg['aviso']} />
        {vigente && <p>O texto de uma versão publicada não muda. Ao publicar outra, todos precisam dar ciência de novo.</p>}
      </section>

      {prazos && (
        <section className="cartao" aria-label="Prazos de guarda">
          <h2>Prazos de guarda</h2>
          <p>Passado o prazo, a limpeza diária apaga o dado. Em dias.</p>
          <form onSubmit={salvarPrazos} className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            {PRAZOS.map((c) => (
              <label key={c.campo}>{c.rotulo}
                <input type="number" inputMode="numeric" min={c.min} max={3650} required value={prazos[c.campo]}
                  onChange={(e) => setPrazos({ ...prazos, [c.campo]: Number(e.target.value) })} aria-describedby={`ajuda-${c.campo}`} />
                <small id={`ajuda-${c.campo}`}>{c.ajuda}</small>
              </label>
            ))}
            <label>Contato do encarregado (DPO)
              <input value={prazos.encarregado_contato ?? ''} placeholder="nome e e-mail" onChange={(e) => setPrazos({ ...prazos, encarregado_contato: e.target.value })} />
              <small>Aparece para todos em Meu perfil.</small>
            </label>
            <div className="acoes"><button type="submit">Salvar prazos</button></div>
          </form>
          <Retorno m={msg['prazos']} />
        </section>
      )}

      <section className="cartao" aria-label="Remover dados de uma pessoa">
        <h2>Remover dados de uma pessoa</h2>
        <p>Para quem saiu da empresa ou pediu exclusão. Apaga nome, CNH, documentos, avisos e localização, e encerra o acesso. O histórico de reservas fica, como “Pessoa removida”, para prestação de contas. Pessoas desligadas há mais de {prazos?.retencao_inativos_dias ?? 365} dias são removidas automaticamente.</p>
        <form onSubmit={anonimizar} className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          <label>Pessoa
            <select required value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">Escolha</option>
              {removiveis.map((p) => <option key={p.user_id} value={p.user_id}>{p.nome ?? 'Sem nome'}{p.ativo ? '' : p.inativado_em ? ` (desligada em ${dataBr(p.inativado_em)})` : ' (desligada)'}</option>)}
            </select>
          </label>
          <label>Motivo
            <input required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pedido de exclusão de 10/11" />
          </label>
          <div className="acoes"><button type="submit" className="perigo">Remover dados</button></div>
        </form>
        <Retorno m={msg['anon']} />
      </section>
    </main>
  )
}
