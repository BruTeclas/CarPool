import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatarDataHora } from '../lib/datas'
import { Veiculo } from '../components/Placa'
import { Situacao } from '../components/Situacao'
import { supabase } from '../lib/supabase'

type Reserva = { id: string; inicio: string; fim: string; status: string; veiculos: { placa: string; modelo: string } | null }

export default function MinhasReservas() {
  const { session } = useAuth()
  const [lista, setLista] = useState<Reserva[] | null>(null)
  const uid = session?.user.id

  useEffect(() => {
    if (!uid) return
    supabase
      .from('reservas')
      .select('id, inicio, fim, status, veiculos(placa, modelo)')
      .or(`motorista_id.eq.${uid},solicitante_id.eq.${uid}`)
      .order('inicio', { ascending: false })
      .limit(50)
      .returns<Reserva[]>()
      .then(({ data }) => setLista(data ?? []))
  }, [uid])

  return (
    <main>
      <h1>Minhas reservas</h1>
      <section className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Veículo</th><th>Retirada</th><th>Devolução</th><th>Situação</th><th><span className="so-leitor">Ações</span></th></tr></thead>
            <tbody>
              {lista?.length === 0 && (
                <tr><td colSpan={5} className="vazio">Você ainda não tem reservas. <Link to="/reservar">Reservar um veículo</Link></td></tr>
              )}
              {lista?.map((r) => (
                <tr key={r.id}>
                  <td><Veiculo placa={r.veiculos?.placa} modelo={r.veiculos?.modelo} /></td>
                  <td>{formatarDataHora(r.inicio)}</td>
                  <td>{formatarDataHora(r.fim)}</td>
                  <td><Situacao status={r.status} /></td>
                  <td className="acoes"><Link to={`/reservas/${r.id}`}>Ver detalhes</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
