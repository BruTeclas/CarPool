import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeCadastro } from '../lib/erros-banco'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Config = {
  antecedencia_min_horas: number
  antecedencia_max_dias: number
  duracao_max_horas: number
  limite_semanal_horas: number
  intervalo_tecnico_min: number
  tolerancia_noshow_min: number
  tolerancia_atraso_min: number
  cancelamento_min_horas: number
  aprovar_pernoite: boolean
  aprovar_fim_de_semana: boolean
}
type Politica = { id: string; nome: string; versao: number; ativa: boolean; grupo_id: string | null; base_id: string | null; config: Partial<Config> }

const PADRAO: Config = {
  antecedencia_min_horas: 1, antecedencia_max_dias: 60, duracao_max_horas: 12, limite_semanal_horas: 40,
  intervalo_tecnico_min: 30, tolerancia_noshow_min: 30, tolerancia_atraso_min: 15, cancelamento_min_horas: 2,
  aprovar_pernoite: true, aprovar_fim_de_semana: true,
}
const NUMEROS: { chave: keyof Config; rotulo: string }[] = [
  { chave: 'antecedencia_min_horas', rotulo: 'Antecedência mínima (horas)' },
  { chave: 'antecedencia_max_dias', rotulo: 'Antecedência máxima (dias)' },
  { chave: 'duracao_max_horas', rotulo: 'Duração máxima por reserva (horas)' },
  { chave: 'limite_semanal_horas', rotulo: 'Limite semanal por pessoa (horas)' },
  { chave: 'intervalo_tecnico_min', rotulo: 'Intervalo entre reservas (minutos)' },
  { chave: 'tolerancia_noshow_min', rotulo: 'Tolerância de retirada (minutos)' },
  { chave: 'tolerancia_atraso_min', rotulo: 'Tolerância de atraso (minutos)' },
  { chave: 'cancelamento_min_horas', rotulo: 'Cancelar sem penalidade até (horas antes)' },
]

export default function Politicas() {
  const { empresaId, podeGerir } = useEmpresa()
  const grupos = useOpcoes('grupos', 'id', 'nome', empresaId)
  const bases = useOpcoes('bases', 'id', 'nome', empresaId)
  const [lista, setLista] = useState<Politica[]>([])
  const [nome, setNome] = useState('')
  const [grupoId, setGrupoId] = useState('')
  const [baseId, setBaseId] = useState('')
  const [config, setConfig] = useState<Config>(PADRAO)
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const { data } = await supabase.from('politicas').select('*').eq('empresa_id', empresaId)
      .order('nome').order('versao', { ascending: false }).returns<Politica[]>()
    setLista(data ?? [])
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    const nomeLimpo = nome.trim()
    const anteriores = lista.filter((p) => p.nome === nomeLimpo)
    const versao = Math.max(0, ...anteriores.map((p) => p.versao)) + 1
    const { error } = await supabase.from('politicas').insert({
      empresa_id: empresaId, nome: nomeLimpo, versao, config,
      grupo_id: grupoId || null, base_id: baseId || null,
    })
    if (error) return setMensagem({ texto: mensagemDeCadastro(error), erro: true })
    const ativasAntigas = anteriores.filter((p) => p.ativa).map((p) => p.id)
    if (ativasAntigas.length) await supabase.from('politicas').update({ ativa: false }).in('id', ativasAntigas)
    setMensagem({
      texto: versao > 1
        ? `Versão ${versao} publicada. As pessoas precisam aceitar a nova versão antes da próxima reserva.`
        : 'Política criada. As pessoas precisam aceitá-la antes da próxima reserva.',
      erro: false,
    })
    await carregar()
  }

  function novaVersao(p: Politica) {
    setNome(p.nome)
    setGrupoId(p.grupo_id ?? '')
    setBaseId(p.base_id ?? '')
    setConfig({ ...PADRAO, ...p.config })
    setMensagem(null)
  }

  async function alternar(p: Politica) {
    const { error } = await supabase.from('politicas').update({ ativa: !p.ativa }).eq('id', p.id)
    if (error) setMensagem({ texto: mensagemDeCadastro(error), erro: true })
    await carregar()
  }

  const escopo = (p: Politica) =>
    p.grupo_id ? `Grupo: ${grupos.find((g) => g.valor === p.grupo_id)?.rotulo ?? '—'}`
      : p.base_id ? `Base: ${bases.find((b) => b.valor === p.base_id)?.rotulo ?? '—'}`
        : 'Toda a empresa'

  return (
    <main>
      <h1>Políticas de uso</h1>
      <p>Sem nenhuma política ativa, valem os padrões do sistema. Política de grupo vence a de base, que vence a da empresa.</p>
      <section className="cartao" aria-label="Políticas cadastradas">
        <h2>Políticas cadastradas</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Nome</th><th>Versão</th><th>Vale para</th><th>Situação</th>{podeGerir && <th><span className="so-leitor">Ações</span></th>}</tr></thead>
            <tbody>
              {lista.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma política. Estão valendo os padrões do sistema.</td></tr>}
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>{p.nome}</td><td>{p.versao}</td><td>{escopo(p)}</td><td>{p.ativa ? 'Ativa' : 'Inativa'}</td>
                  {podeGerir && (
                    <td className="acoes">
                      <button type="button" className="secundario" onClick={() => novaVersao(p)}>Nova versão</button>
                      <button type="button" className="secundario" onClick={() => alternar(p)}>{p.ativa ? 'Desativar' : 'Ativar'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {podeGerir && (
        <section className="cartao" aria-label="Nova política ou versão">
          <h2>Nova política ou nova versão</h2>
          <form onSubmit={salvar} className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <label>Nome
              <input required value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label>Só para o grupo (opcional)
              <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
                <option value="">Todos</option>
                {grupos.map((g) => <option key={g.valor} value={g.valor}>{g.rotulo}</option>)}
              </select>
            </label>
            <label>Só para a base (opcional)
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                <option value="">Todas</option>
                {bases.map((b) => <option key={b.valor} value={b.valor}>{b.rotulo}</option>)}
              </select>
            </label>
            {NUMEROS.map((n) => (
              <label key={n.chave}>{n.rotulo}
                <input type="number" min={0} required value={config[n.chave] as number}
                  onChange={(e) => setConfig({ ...config, [n.chave]: Number(e.target.value) })} />
              </label>
            ))}
            <label className="linha">
              <input type="checkbox" checked={config.aprovar_pernoite} onChange={(e) => setConfig({ ...config, aprovar_pernoite: e.target.checked })} />
              Pernoite exige aprovação
            </label>
            <label className="linha">
              <input type="checkbox" checked={config.aprovar_fim_de_semana} onChange={(e) => setConfig({ ...config, aprovar_fim_de_semana: e.target.checked })} />
              Fim de semana exige aprovação
            </label>
            <div className="acoes"><button type="submit">Publicar</button></div>
          </form>
          {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
        </section>
      )}
    </main>
  )
}
