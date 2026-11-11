import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { rotuloStatus } from '../lib/status'
import { supabase } from '../lib/supabase'

type Reserva = {
  id: string; inicio: string; fim: string; status: string; motorista_id: string
  veiculos: { placa: string; modelo: string } | null
}

export default function Portaria() {
  const { empresaId, podeOperar } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [codigo, setCodigo] = useState('')
  const [achada, setAchada] = useState<Reserva | null>(null)
  const [agenda, setAgenda] = useState<Reserva[]>([])
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const nome = (uid: string) => pessoas.find((p) => p.valor === uid)?.rotulo ?? 'Usuário'
  const campos = 'id, inicio, fim, status, motorista_id, veiculos(placa, modelo)'

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const agora = Date.now()
    const { data } = await supabase.from('reservas').select(campos).eq('empresa_id', empresaId)
      .in('status', ['aprovada', 'liberada', 'em_uso', 'atrasada', 'devolvida'])
      .lt('inicio', new Date(agora + 24 * 3600e3).toISOString())
      .order('inicio').returns<Reserva[]>()
    setAgenda(data ?? [])
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  async function buscar(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    setAchada(null)
    const { data } = await supabase.from('reservas').select(campos).eq('empresa_id', empresaId ?? '')
      .eq('codigo_retirada', codigo.trim()).eq('status', 'aprovada').order('inicio').limit(1).returns<Reserva[]>()
    if (!data?.length) return setMensagem({ texto: 'Nenhuma reserva confirmada com esse código.', erro: true })
    setAchada(data[0])
  }

  async function entregar() {
    if (!achada) return
    const { error } = await supabase.rpc('transicionar_reserva', {
      p_reserva: achada.id, p_para: 'liberada', p_detalhe: { via: 'portaria' },
    })
    if (error) return setMensagem({ texto: mensagemDeErro(error), erro: true })
    setMensagem({ texto: `Chave do ${achada.veiculos?.placa} entregue a ${nome(achada.motorista_id)}.`, erro: false })
    setAchada(null)
    setCodigo('')
    await carregar()
  }

  if (!podeOperar) return <main><p role="alert" className="erro">Você não tem acesso à portaria.</p></main>

  return (
    <main>
      <h1>Portaria</h1>
      <section className="cartao" aria-label="Entregar chave">
        <h2>Entregar chave</h2>
        <form onSubmit={buscar} className="acoes">
          <label>Código de retirada informado pelo motorista
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </label>
          <button type="submit">Buscar</button>
        </form>
        {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
        {achada && (
          <div className="aviso" style={{ marginTop: 12 }}>
            <p><strong>{nome(achada.motorista_id)}</strong> · {achada.veiculos?.placa} {achada.veiculos?.modelo}<br />
              {formatarDataHora(achada.inicio)} até {formatarDataHora(achada.fim)}</p>
            <p>Confira o documento da pessoa antes de entregar.</p>
            <button type="button" onClick={entregar}>Confirmar entrega da chave</button>
          </div>
        )}
      </section>
      <section className="cartao" aria-label="Movimento">
        <h2>Movimento (em aberto e próximas 24 h)</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Veículo</th><th>Motorista</th><th>Retirada</th><th>Devolução</th><th>Situação</th><th><span className="so-leitor">Ações</span></th></tr></thead>
            <tbody>
              {agenda.length === 0 && <tr><td colSpan={6} className="vazio">Nenhum movimento.</td></tr>}
              {agenda.map((r) => (
                <tr key={r.id}>
                  <td>{r.veiculos?.placa} · {r.veiculos?.modelo}</td><td>{nome(r.motorista_id)}</td>
                  <td>{formatarDataHora(r.inicio)}</td><td>{formatarDataHora(r.fim)}</td>
                  <td>{rotuloStatus(r.status)}</td>
                  <td className="acoes"><Link to={`/reservas/${r.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
