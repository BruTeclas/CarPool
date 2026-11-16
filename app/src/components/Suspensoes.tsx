import { useCallback, useEffect, useState } from 'react'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Suspensao = { id: string; user_id: string; inicio: string; fim: string; motivo: string }

/** Motoristas suspensos agora, com a opção de retirar a suspensão (admin e gestor de frota). */
export function Suspensoes() {
  const { empresaId, podeGerir } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [lista, setLista] = useState<Suspensao[]>([])
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const { data } = await supabase.from('suspensoes').select('id, user_id, inicio, fim, motivo')
      .eq('empresa_id', empresaId).is('levantada_em', null).gt('fim', new Date().toISOString()).order('fim').returns<Suspensao[]>()
    setLista(data ?? [])
  }, [empresaId])
  useEffect(() => { void carregar() }, [carregar])

  async function retirar(s: Suspensao) {
    const motivo = window.prompt('Por que retirar a suspensão? (fica registrado)')
    if (!motivo?.trim()) return
    const { error } = await supabase.rpc('levantar_suspensao', { p_suspensao: s.id, p_motivo: motivo })
    setMensagem(error ? { texto: mensagemDeErro(error), erro: true } : { texto: 'Suspensão retirada. A pessoa foi avisada.', erro: false })
    await carregar()
  }

  return (
    <section className="cartao" aria-label="Suspensões">
      <h2>Suspensões</h2>
      <p>Quem acumula faltas (não comparecimento ou atraso) no período da política fica sem poder reservar por alguns dias.</p>
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
      {lista.length === 0 && <p>Ninguém suspenso agora.</p>}
      {lista.map((s) => (
        <div key={s.id} className="doc-linha">
          <div className="doc-topo">
            <strong>{pessoas.find((p) => p.valor === s.user_id)?.rotulo ?? 'Pessoa'}</strong>
            <span>Até {formatarDataHora(s.fim)}</span>
          </div>
          <p style={{ margin: 0 }}>{s.motivo}</p>
          {podeGerir && <div className="acoes"><button type="button" className="secundario" onClick={() => retirar(s)}>Retirar suspensão</button></div>}
        </div>
      ))}
    </section>
  )
}
