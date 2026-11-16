import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { avisarMudanca } from '../lib/avisos'
import { formatarDataHora } from '../lib/datas'
import { supabase } from '../lib/supabase'

type Aviso = { id: string; titulo: string; corpo: string | null; link: string | null; importante: boolean; criada_em: string; lida_em: string | null }

export default function Avisos() {
  const { session } = useAuth()
  const [avisos, setAvisos] = useState<Aviso[] | null>(null)
  const uid = session?.user.id

  useEffect(() => {
    if (!uid) return
    supabase.from('notificacoes').select('id, titulo, corpo, link, importante, criada_em, lida_em')
      .eq('user_id', uid).order('criada_em', { ascending: false }).limit(100).returns<Aviso[]>()
      .then(async ({ data }) => {
        setAvisos(data ?? [])
        // abrir a lista conta como leitura; os novos continuam destacados até sair da tela
        if ((data ?? []).some((a) => !a.lida_em)) { await supabase.rpc('marcar_notificacoes_lidas'); avisarMudanca() }
      })
  }, [uid])

  return (
    <main style={{ maxWidth: 760 }}>
      <h1>Avisos</h1>
      {avisos === null && <p>Carregando…</p>}
      {avisos?.length === 0 && <section className="cartao"><p>Nenhum aviso por enquanto.</p></section>}
      {avisos && avisos.length > 0 && (
        <section className="cartao lista-avisos" aria-label="Seus avisos">
          {avisos.map((a) => (
            <article key={a.id} className={`aviso-item${a.lida_em ? '' : ' novo'}${a.importante ? ' importante' : ''}`}>
              <div className="doc-topo">
                <strong>{a.titulo}</strong>
                <small>{!a.lida_em && <span className="selo-novo">Novo</span>}{formatarDataHora(a.criada_em)}</small>
              </div>
              {a.corpo && <p style={{ margin: '4px 0 0' }}>{a.corpo}</p>}
              {a.link && <p style={{ margin: '6px 0 0' }}><Link to={a.link}>Ver reserva</Link></p>}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
