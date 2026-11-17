import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { dataBr } from '../lib/documentos'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { rotuloPerfil } from '../lib/perfis'
import { baixarMeusDados, SITUACOES_DE_PEDIDO, TIPOS_DE_PEDIDO } from '../lib/privacidade'
import type { AvisoPrivacidade, Solicitacao } from '../lib/privacidade'
import { CampoSenha } from '../components/CampoSenha'
import { supabase } from '../lib/supabase'

type Mensagem = { texto: string; erro: boolean } | null

function Retorno({ m }: { m: Mensagem }) {
  if (!m) return null
  return <p role={m.erro ? 'alert' : 'status'} className={m.erro ? 'erro' : 'sucesso'}>{m.texto}</p>
}

export default function MeuPerfil() {
  const { session } = useAuth()
  const { empresaId, empresaNome, perfis } = useEmpresa()
  const uid = session?.user.id
  const [senha, setSenha] = useState('')
  const [msgSenha, setMsgSenha] = useState<Mensagem>(null)
  const [nome, setNome] = useState('')
  const [msgNome, setMsgNome] = useState<Mensagem>(null)
  const [msgDados, setMsgDados] = useState<Mensagem>(null)
  const [baixando, setBaixando] = useState(false)
  const [tipo, setTipo] = useState<Solicitacao['tipo']>('correcao')
  const [descricao, setDescricao] = useState('')
  const [msgPedido, setMsgPedido] = useState<Mensagem>(null)
  const [pedidos, setPedidos] = useState<Solicitacao[]>([])
  const [aviso, setAviso] = useState<AvisoPrivacidade | null>(null)
  const [encarregado, setEncarregado] = useState('')

  const carregar = useCallback(async () => {
    if (!empresaId || !uid) return
    const [m, s, a, e] = await Promise.all([
      supabase.from('membros').select('nome').eq('empresa_id', empresaId).eq('user_id', uid).limit(1).maybeSingle(),
      supabase.from('solicitacoes_titular').select('*').eq('empresa_id', empresaId).eq('user_id', uid)
        .order('criado_em', { ascending: false }).returns<Solicitacao[]>(),
      supabase.from('avisos_privacidade').select('*').eq('empresa_id', empresaId).eq('ativo', true)
        .order('versao', { ascending: false }).limit(1).returns<AvisoPrivacidade[]>(),
      supabase.from('empresas').select('encarregado_contato').eq('id', empresaId).maybeSingle(),
    ])
    setNome((m.data as { nome: string } | null)?.nome ?? '')
    setPedidos(s.data ?? [])
    setAviso(a.data?.[0] ?? null)
    setEncarregado((e.data as { encarregado_contato: string | null } | null)?.encarregado_contato ?? '')
  }, [empresaId, uid])

  useEffect(() => { void carregar() }, [carregar])

  async function trocarSenha(e: FormEvent) {
    e.preventDefault()
    setMsgSenha(null)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return setMsgSenha({ texto: 'Não foi possível trocar a senha. Use ao menos 8 caracteres.', erro: true })
    setSenha('')
    setMsgSenha({ texto: 'Senha alterada.', erro: false })
  }

  async function salvarNome(e: FormEvent) {
    e.preventDefault()
    setMsgNome(null)
    const { error } = await supabase.rpc('atualizar_meu_nome', { p_empresa: empresaId, p_nome: nome })
    setMsgNome(error ? { texto: mensagemDeErro(error), erro: true } : { texto: 'Nome atualizado.', erro: false })
  }

  async function baixar() {
    if (!empresaId) return
    setMsgDados(null)
    setBaixando(true)
    const ok = await baixarMeusDados(empresaId)
    setBaixando(false)
    setMsgDados(ok ? { texto: 'Arquivo baixado.', erro: false } : { texto: 'Não foi possível gerar o arquivo. Tente novamente.', erro: true })
  }

  async function pedir(e: FormEvent) {
    e.preventDefault()
    setMsgPedido(null)
    const { error } = await supabase.rpc('pedir_ao_controlador', { p_empresa: empresaId, p_tipo: tipo, p_descricao: descricao.trim() })
    if (error) return setMsgPedido({ texto: mensagemDeErro(error), erro: true })
    setDescricao('')
    await carregar()
    setMsgPedido({ texto: 'Pedido enviado. A resposta aparece aqui e em Avisos.', erro: false })
  }

  return (
    <main>
      <h1>Meu perfil</h1>
      <section className="cartao">
        <p><strong>{session?.user.email}</strong></p>
        <p>{empresaNome}{perfis.length > 0 && `, como ${perfis.map(rotuloPerfil).join(', ').toLowerCase()}`}</p>
      </section>

      <section className="cartao" aria-label="Nome">
        <h2>Seu nome</h2>
        <form onSubmit={salvarNome} className="acoes">
          <label>Nome completo
            <input required minLength={3} autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <button type="submit">Salvar nome</button>
        </form>
        <Retorno m={msgNome} />
      </section>

      <section className="cartao" aria-label="Trocar senha">
        <h2>Trocar senha</h2>
        <form onSubmit={trocarSenha} className="acoes">
          <CampoSenha rotulo="Nova senha" autoComplete="new-password" minLength={8} required value={senha} onChange={(e) => setSenha(e.target.value)} />
          <button type="submit">Salvar senha</button>
        </form>
        <Retorno m={msgSenha} />
      </section>

      <section className="cartao" aria-label="Seus dados pessoais">
        <h2>Seus dados pessoais</h2>
        <p>Você pode baixar uma cópia de tudo o que {empresaNome || 'a empresa'} guarda sobre você no sistema: cadastro, CNH, documentos, reservas, vistorias, ocorrências e pedidos.</p>
        <div className="acoes">
          <button type="button" className="secundario" onClick={baixar} disabled={baixando}>{baixando ? 'Gerando…' : 'Baixar meus dados'}</button>
        </div>
        <Retorno m={msgDados} />

        <h3>Fazer um pedido sobre seus dados</h3>
        <form onSubmit={pedir} style={{ display: 'grid', gap: 14 }}>
          <label>Tipo de pedido
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Solicitacao['tipo'])}>
              {Object.entries(TIPOS_DE_PEDIDO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label>O que você precisa
            <textarea required rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)}
              placeholder={tipo === 'eliminacao' ? 'Ex.: saí da empresa e quero que meus dados sejam apagados.' : 'Ex.: o número da minha CNH está errado.'} />
          </label>
          <div className="acoes"><button type="submit">Enviar pedido</button></div>
        </form>
        <Retorno m={msgPedido} />
        {tipo === 'eliminacao' && <p>O histórico de reservas e vistorias é guardado pelo prazo legal, mas sem o seu nome. Documentos, CNH e localização são apagados.</p>}

        {pedidos.length > 0 && (
          <>
            <h3>Seus pedidos</h3>
            <ul>
              {pedidos.map((p) => (
                <li key={p.id}>
                  <strong>{TIPOS_DE_PEDIDO[p.tipo]}</strong>, em {dataBr(p.criado_em)}: {SITUACOES_DE_PEDIDO[p.status]}
                  {p.resposta && <><br />Resposta: {p.resposta}</>}
                </li>
              ))}
            </ul>
          </>
        )}

        {aviso && (
          <details>
            <summary>Ler o aviso de privacidade (versão {aviso.versao})</summary>
            <div className="texto-termo">{aviso.texto}</div>
          </details>
        )}
        {encarregado && <p>Encarregado de dados (DPO): {encarregado}</p>}
      </section>
    </main>
  )
}
