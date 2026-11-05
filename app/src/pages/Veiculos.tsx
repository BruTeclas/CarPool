import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Veiculo = { id: string; placa: string; modelo: string; status: string; odometro_km: number }
type Opcao = { id: string; nome: string }

export default function Veiculos() {
  const [lista, setLista] = useState<Veiculo[]>([])
  const [bases, setBases] = useState<Opcao[]>([])
  const [categorias, setCategorias] = useState<Opcao[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState({ placa: '', modelo: '', base_id: '', categoria_id: '' })

  const carregar = useCallback(async () => {
    const [v, b, c] = await Promise.all([
      supabase.from('veiculos').select('id, placa, modelo, status, odometro_km').order('placa'),
      supabase.from('bases').select('id, nome').order('nome'),
      supabase.from('categorias').select('id, nome').order('nome'),
    ])
    if (v.error) setErro('Não foi possível carregar os veículos.')
    setLista((v.data as Veiculo[]) ?? [])
    setBases((b.data as Opcao[]) ?? [])
    setCategorias((c.data as Opcao[]) ?? [])
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    const { data: base } = await supabase.from('bases').select('empresa_id').eq('id', form.base_id).single()
    const { error } = await supabase.from('veiculos').insert({
      empresa_id: base?.empresa_id,
      placa: form.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      modelo: form.modelo,
      base_id: form.base_id,
      categoria_id: form.categoria_id,
    })
    if (error) setErro('Não foi possível salvar. Confira a placa e se você tem permissão de gestor.')
    else {
      setForm({ placa: '', modelo: '', base_id: form.base_id, categoria_id: form.categoria_id })
      await carregar()
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <p><Link to="/">← Meu perfil</Link></p>
      <h1>Frota</h1>
      {erro && <p role="alert" style={{ color: '#b00020' }}>{erro}</p>}
      <ul>
        {lista.map((v) => (
          <li key={v.id}>{v.placa} · {v.modelo} · {v.odometro_km} km · {v.status}</li>
        ))}
      </ul>
      <h2>Cadastrar veículo</h2>
      <form onSubmit={salvar} style={{ display: 'grid', gap: 8 }}>
        <input placeholder="Placa" required value={form.placa} maxLength={8}
          onChange={(e) => setForm({ ...form, placa: e.target.value })} aria-label="Placa" />
        <input placeholder="Modelo" required value={form.modelo}
          onChange={(e) => setForm({ ...form, modelo: e.target.value })} aria-label="Modelo" />
        <select required value={form.base_id} onChange={(e) => setForm({ ...form, base_id: e.target.value })} aria-label="Base">
          <option value="">Base…</option>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
        <select required value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })} aria-label="Categoria">
          <option value="">Categoria…</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <button type="submit">Salvar</button>
      </form>
    </main>
  )
}
