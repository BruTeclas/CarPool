import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeCadastro } from '../lib/erros-banco'
import type { Opcao } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

export type Campo = {
  nome: string
  rotulo: string
  tipo?: 'texto' | 'numero' | 'data' | 'selecao'
  opcoes?: Opcao[]
  obrigatorio?: boolean
  converter?: (valor: string) => unknown
}

type Linha = Record<string, unknown> & { id: string }

type Props = {
  titulo: string
  tabela: string
  campos: Campo[]
  ordem: string
  podeEditar: boolean
  semCriar?: boolean
  semExcluir?: boolean
  versao?: number
  aoMudar?: () => void
}

const vazio = (campos: Campo[]) => Object.fromEntries(campos.map((c) => [c.nome, '']))

function exibir(campo: Campo, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (campo.tipo === 'selecao') return campo.opcoes?.find((o) => o.valor === String(valor))?.rotulo ?? String(valor)
  if (campo.tipo === 'data') return String(valor).split('-').reverse().join('/')
  return String(valor)
}

export function Crud({ titulo, tabela, campos, ordem, podeEditar, semCriar, semExcluir, versao = 0, aoMudar }: Props) {
  const { empresaId } = useEmpresa()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [form, setForm] = useState<Record<string, string>>(() => vazio(campos))
  const [editando, setEditando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const { data, error } = await supabase.from(tabela).select('*').eq('empresa_id', empresaId).order(ordem)
    if (error) setErro('Não foi possível carregar a lista.')
    else setLinhas((data ?? []) as Linha[])
  }, [empresaId, tabela, ordem])

  useEffect(() => { void carregar() }, [carregar, versao])

  function limpar() {
    setForm(vazio(campos))
    setEditando(null)
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    const dados: Record<string, unknown> = {}
    for (const c of campos) {
      const bruto = (form[c.nome] ?? '').trim()
      dados[c.nome] = bruto === '' ? null : c.converter ? c.converter(bruto) : c.tipo === 'numero' ? Number(bruto) : bruto
    }
    const { error } = editando
      ? await supabase.from(tabela).update(dados).eq('id', editando)
      : await supabase.from(tabela).insert({ ...dados, empresa_id: empresaId })
    if (error) return setErro(mensagemDeCadastro(error))
    limpar()
    await carregar()
    aoMudar?.()
  }

  function editar(linha: Linha) {
    setEditando(linha.id)
    setForm(Object.fromEntries(campos.map((c) => [c.nome, linha[c.nome] == null ? '' : String(linha[c.nome])])))
    setErro(null)
  }

  async function excluir(linha: Linha) {
    if (!window.confirm('Excluir este registro? Essa ação não pode ser desfeita.')) return
    setErro(null)
    const { error } = await supabase.from(tabela).delete().eq('id', linha.id)
    if (error) return setErro(mensagemDeCadastro(error))
    if (editando === linha.id) limpar()
    await carregar()
    aoMudar?.()
  }

  const mostraForm = podeEditar && (!semCriar || editando !== null)

  return (
    <section className="cartao" aria-label={titulo}>
      <h2>{titulo}</h2>
      {erro && <p role="alert" className="erro">{erro}</p>}
      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              {campos.map((c) => <th key={c.nome}>{c.rotulo}</th>)}
              {podeEditar && <th><span className="so-leitor">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={campos.length + 1} className="vazio">Nenhum registro ainda.</td></tr>
            )}
            {linhas.map((l) => (
              <tr key={l.id}>
                {campos.map((c) => <td key={c.nome}>{exibir(c, l[c.nome])}</td>)}
                {podeEditar && (
                  <td className="acoes">
                    <button type="button" className="secundario" onClick={() => editar(l)}>Editar</button>
                    {!semExcluir && <button type="button" className="perigo" onClick={() => excluir(l)}>Excluir</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mostraForm && (
        <form onSubmit={salvar} className="form-grade">
          <h3>{editando ? 'Editar' : 'Adicionar'}</h3>
          {campos.map((c) => (
            <label key={c.nome}>
              {c.rotulo}{c.obrigatorio ? '' : ' (opcional)'}
              {c.tipo === 'selecao' ? (
                <select required={c.obrigatorio} value={form[c.nome] ?? ''} onChange={(e) => setForm({ ...form, [c.nome]: e.target.value })}>
                  <option value="">Selecione…</option>
                  {c.opcoes?.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
              ) : (
                <input
                  type={c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : 'text'}
                  required={c.obrigatorio}
                  value={form[c.nome] ?? ''}
                  onChange={(e) => setForm({ ...form, [c.nome]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="acoes">
            <button type="submit">{editando ? 'Salvar alterações' : 'Adicionar'}</button>
            {editando && <button type="button" className="secundario" onClick={limpar}>Cancelar</button>}
          </div>
        </form>
      )}
    </section>
  )
}
