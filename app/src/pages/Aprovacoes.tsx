import { useCallback, useEffect, useState } from 'react'
import { Veiculo } from '../components/Placa'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Pedido = {
  id: string; inicio: string; fim: string; finalidade: string | null; destino: string | null
  motorista_id: string; veiculos: { placa: string; modelo: string } | null
}

export default function Aprovacoes() {
  const { empresaId, podeAprovar } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null)
  const [justificativas, setJustificativas] = useState<Record<string, string>>({})
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const { data } = await supabase.from('reservas')
      .select('id, inicio, fim, finalidade, destino, motorista_id, veiculos(placa, modelo)')
      .eq('empresa_id', empresaId).eq('status', 'solicitada').order('inicio').returns<Pedido[]>()
    setPedidos(data ?? [])
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  async function decidir(p: Pedido, para: 'aprovada' | 'recusada') {
    setMensagem(null)
    const justificativa = (justificativas[p.id] ?? '').trim()
    if (para === 'recusada' && !justificativa) {
      return setMensagem({ texto: 'Para recusar, escreva a justificativa.', erro: true })
    }
    const { error } = await supabase.rpc('transicionar_reserva', {
      p_reserva: p.id, p_para: para, p_detalhe: justificativa ? { justificativa } : {},
    })
    if (error) setMensagem({ texto: mensagemDeErro(error), erro: true })
    else setMensagem({ texto: para === 'aprovada' ? 'Reserva aprovada.' : 'Reserva recusada.', erro: false })
    await carregar()
  }

  const nome = (uid: string) => pessoas.find((x) => x.valor === uid)?.rotulo ?? 'Usuário'

  if (!podeAprovar) return <main><p role="alert" className="erro">Você não tem permissão para aprovar reservas.</p></main>

  return (
    <main>
      <h1>Aprovações</h1>
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
      {pedidos?.length === 0 && <p>Nenhuma reserva aguardando aprovação.</p>}
      {pedidos?.map((p) => (
        <section key={p.id} className="cartao" aria-label={`Pedido de ${nome(p.motorista_id)}`}>
          <h2>{nome(p.motorista_id)}</h2>
          <p><Veiculo placa={p.veiculos?.placa} modelo={p.veiculos?.modelo} /></p>
          <p>{formatarDataHora(p.inicio)} até {formatarDataHora(p.fim)}</p>
          {(p.finalidade || p.destino) && <p>{[p.finalidade, p.destino].filter(Boolean).join(', ')}</p>}
          <label>Justificativa (obrigatória para recusar)
            <input value={justificativas[p.id] ?? ''} onChange={(e) => setJustificativas({ ...justificativas, [p.id]: e.target.value })} />
          </label>
          <div className="acoes" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => decidir(p, 'aprovada')}>Aprovar</button>
            <button type="button" className="perigo" onClick={() => decidir(p, 'recusada')}>Recusar</button>
          </div>
        </section>
      ))}
    </main>
  )
}
