import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Crud } from '../components/Crud'
import { Placa } from '../components/Placa'
import { abrirArquivo, dataBr, subirArquivo } from '../lib/documentos'
import type { Documento, TipoDocumento } from '../lib/documentos'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

const SIM_NAO = [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }]
const ALVOS = [{ valor: 'condutor', rotulo: 'Condutor' }, { valor: 'veiculo', rotulo: 'Veículo' }]
type Vencendo = { documento_id: string; tipo: string; alvo: string; pessoa: string | null; placa: string | null; validade: string; dias: number }

export default function Documentos() {
  const { empresaId, podeGerir, ehAdmin } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const veiculos = useOpcoes('veiculos', 'id', 'placa', empresaId)
  const [versao, setVersao] = useState(0)
  const [tipos, setTipos] = useState<TipoDocumento[]>([])
  const [pendentes, setPendentes] = useState<Documento[]>([])
  const [vencendo, setVencendo] = useState<Vencendo[]>([])
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  const [veiculoId, setVeiculoId] = useState('')
  const [docsVeiculo, setDocsVeiculo] = useState<Documento[]>([])
  const [envio, setEnvio] = useState<{ tipo: string; validade: string; arquivo: File | null }>({ tipo: '', validade: '', arquivo: null })
  const [dias, setDias] = useState('')
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const [t, p, v, e] = await Promise.all([
      supabase.from('tipos_de_documento').select('*').eq('empresa_id', empresaId).order('nome').returns<TipoDocumento[]>(),
      supabase.from('documentos').select('*').eq('empresa_id', empresaId).eq('status', 'pendente').order('enviado_em').returns<Documento[]>(),
      supabase.rpc('documentos_vencendo', { p_empresa: empresaId }),
      supabase.from('empresas').select('aviso_vencimento_dias').eq('id', empresaId).single(),
    ])
    setTipos(t.data ?? [])
    setPendentes(p.data ?? [])
    setVencendo((v.data as Vencendo[]) ?? [])
    if (e.data) setDias(String(e.data.aviso_vencimento_dias))
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar, versao])

  useEffect(() => {
    if (!veiculoId) return
    supabase.from('documentos').select('*').eq('veiculo_id', veiculoId).order('enviado_em', { ascending: false })
      .returns<Documento[]>().then(({ data }) => setDocsVeiculo(data ?? []))
  }, [veiculoId, versao])

  const nomeTipo = (id: string) => tipos.find((t) => t.id === id)?.nome ?? 'Documento'
  const nomePessoa = (id: string | null) => pessoas.find((p) => p.valor === id)?.rotulo ?? 'Pessoa'

  async function conferir(d: Documento, aprovar: boolean) {
    setMensagem(null)
    const motivo = (motivos[d.id] ?? '').trim()
    if (!aprovar && !motivo) return setMensagem({ texto: 'Para recusar, escreva o motivo.', erro: true })
    const { error } = await supabase.rpc('conferir_documento', { p_documento: d.id, p_aprovar: aprovar, p_motivo: motivo || null })
    setMensagem(error ? { texto: mensagemDeErro(error), erro: true } : { texto: aprovar ? 'Documento aprovado.' : 'Documento recusado. A pessoa verá o motivo.', erro: false })
    setVersao((x) => x + 1)
  }

  async function enviarDoVeiculo(e: FormEvent) {
    e.preventDefault()
    if (!envio.arquivo || !empresaId) return
    setMensagem(null)
    try {
      const caminho = await subirArquivo(empresaId, veiculoId, envio.arquivo, envio.arquivo.name)
      const tipo = tipos.find((t) => t.id === envio.tipo)
      const { error } = await supabase.rpc('enviar_documento', {
        p_tipo: envio.tipo, p_caminho: caminho, p_nome_arquivo: envio.arquivo.name,
        p_validade: tipo?.tem_validade ? envio.validade : null, p_veiculo: veiculoId,
      })
      setMensagem(error ? { texto: mensagemDeErro(error), erro: true } : { texto: 'Documento do veículo registrado.', erro: false })
      if (!error) setEnvio({ tipo: '', validade: '', arquivo: null })
    } catch {
      setMensagem({ texto: 'Não foi possível enviar o arquivo. Use foto ou PDF de até 10 MB.', erro: true })
    }
    setVersao((x) => x + 1)
  }

  async function salvarDias(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('empresas').update({ aviso_vencimento_dias: Number(dias) }).eq('id', empresaId ?? '')
    setMensagem(error ? { texto: 'Não foi possível salvar o prazo.', erro: true } : { texto: 'Prazo de aviso atualizado.', erro: false })
    setVersao((x) => x + 1)
  }

  if (!podeGerir) return <main><p role="alert" className="erro">Você não tem acesso à gestão de documentos.</p></main>
  const tiposVeiculo = tipos.filter((t) => t.alvo === 'veiculo' && t.ativo)
  const tipoEnvio = tipos.find((t) => t.id === envio.tipo)

  return (
    <main>
      <h1>Documentos</h1>
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}

      <section className="cartao" aria-label="Aguardando conferência">
        <h2>Aguardando conferência</h2>
        {pendentes.length === 0 && <p>Nenhum documento para conferir.</p>}
        {pendentes.map((d) => (
          <div key={d.id} className="doc-linha">
            <div className="doc-topo">
              <strong>{nomeTipo(d.tipo_id)} de {nomePessoa(d.user_id)}</strong>
              <span>{d.validade ? `Validade informada: ${dataBr(d.validade)}` : 'Sem validade'}{d.numero ? `, número ${d.numero}` : ''}</span>
            </div>
            <label>Motivo (obrigatório para recusar)
              <input value={motivos[d.id] ?? ''} onChange={(e) => setMotivos({ ...motivos, [d.id]: e.target.value })} />
            </label>
            <div className="acoes">
              <button type="button" className="secundario" onClick={() => abrirArquivo(d.caminho)}>Ver o arquivo</button>
              <button type="button" onClick={() => conferir(d, true)}>Aprovar</button>
              <button type="button" className="perigo" onClick={() => conferir(d, false)}>Recusar</button>
            </div>
          </div>
        ))}
      </section>

      <section className="cartao" aria-label="Vencendo em breve">
        <h2>Vencendo em breve</h2>
        {vencendo.length === 0 && <p>Nenhum documento vencendo no prazo de aviso.</p>}
        {vencendo.length > 0 && (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Documento</th><th>De quem</th><th>Validade</th><th>Situação</th></tr></thead>
              <tbody>
                {vencendo.map((v) => (
                  <tr key={v.documento_id}>
                    <td>{v.tipo}</td>
                    <td>{v.alvo === 'veiculo' ? <Placa valor={v.placa} /> : v.pessoa}</td>
                    <td>{dataBr(v.validade)}</td>
                    <td><span className={`situacao ${v.dias < 0 ? 's-doc-vencido' : 's-doc-pendente'}`}>{v.dias < 0 ? 'Vencido' : v.dias === 0 ? 'Vence hoje' : `Vence em ${v.dias} dia${v.dias === 1 ? '' : 's'}`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ehAdmin && (
          <form onSubmit={salvarDias} className="acoes" style={{ marginTop: 16 }}>
            <label>Avisar com quantos dias de antecedência
              <input type="number" min={1} max={365} required value={dias} onChange={(e) => setDias(e.target.value)} style={{ maxWidth: 140 }} />
            </label>
            <button type="submit" className="secundario">Salvar prazo</button>
          </form>
        )}
      </section>

      <section className="cartao" aria-label="Documentos dos veículos">
        <h2>Documentos dos veículos</h2>
        <label>Veículo
          <select value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Selecione…</option>
            {veiculos.map((v) => <option key={v.valor} value={v.valor}>{v.rotulo}</option>)}
          </select>
        </label>
        {veiculoId && tiposVeiculo.length === 0 && <p style={{ marginTop: 12 }}>Cadastre abaixo os tipos de documento de veículo (CRLV, seguro, licenciamento).</p>}
        {veiculoId && tiposVeiculo.map((t) => {
          const atual = docsVeiculo.find((d) => d.tipo_id === t.id)
          return (
            <div key={t.id} className="doc-linha">
              <div className="doc-topo">
                <strong>{t.nome}</strong>
                <span>{atual ? (atual.validade ? `Válido até ${dataBr(atual.validade)}` : 'Registrado') : 'Não enviado'}</span>
              </div>
              {atual && <div className="acoes"><button type="button" className="secundario" onClick={() => abrirArquivo(atual.caminho)}>Ver o arquivo</button></div>}
            </div>
          )
        })}
        {veiculoId && tiposVeiculo.length > 0 && (
          <form onSubmit={enviarDoVeiculo} className="form-grade" aria-label="Enviar documento do veículo">
            <h3>Registrar documento</h3>
            <label>Tipo
              <select required value={envio.tipo} onChange={(e) => setEnvio({ ...envio, tipo: e.target.value })}>
                <option value="">Selecione…</option>
                {tiposVeiculo.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            <label>Foto ou PDF
              <input type="file" accept="image/*,application/pdf" required onChange={(e) => setEnvio({ ...envio, arquivo: e.target.files?.[0] ?? null })} />
            </label>
            {tipoEnvio?.tem_validade && (
              <label>Validade
                <input type="date" required value={envio.validade} onChange={(e) => setEnvio({ ...envio, validade: e.target.value })} />
              </label>
            )}
            <div className="acoes"><button type="submit">Registrar</button></div>
          </form>
        )}
      </section>

      <Crud titulo="Tipos de documento exigidos" tabela="tipos_de_documento" ordem="nome" podeEditar={podeGerir} semExcluir
        aoMudar={() => setVersao((x) => x + 1)}
        campos={[
          { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
          { nome: 'alvo', rotulo: 'De quem', tipo: 'selecao', opcoes: ALVOS, obrigatorio: true },
          { nome: 'obrigatorio', rotulo: 'Obrigatório', tipo: 'selecao', opcoes: SIM_NAO, obrigatorio: true, converter: (v) => v === 'true' },
          { nome: 'tem_validade', rotulo: 'Tem validade', tipo: 'selecao', opcoes: SIM_NAO, obrigatorio: true, converter: (v) => v === 'true' },
          { nome: 'ativo', rotulo: 'Ativo', tipo: 'selecao', opcoes: SIM_NAO, obrigatorio: true, converter: (v) => v === 'true' },
        ]} />
    </main>
  )
}
