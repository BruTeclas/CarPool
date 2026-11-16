import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'

type Item = {
  id: string; titulo: string; descricao: string | null; versao: number; nota_minima: number; etapas: number; minutos: number | null
  concluidas: number; conteudo_concluido_em: string | null; aprovado_em: string | null; nota: number | null; valido_ate: string | null
  aguardando_correcao: boolean
}

function situacao(t: Item): { texto: string; classe: string } {
  if (t.aprovado_em && (!t.valido_ate || new Date(t.valido_ate) > new Date())) {
    return { texto: t.valido_ate ? `Aprovado · válido até ${new Date(t.valido_ate).toLocaleDateString('pt-BR')}` : 'Aprovado', classe: 's-aprovada' }
  }
  if (t.aprovado_em) return { texto: 'Vencido: refaça', classe: 's-atrasada' }
  if (t.aguardando_correcao) return { texto: 'Prova em correção', classe: 's-solicitada' }
  if (t.conteudo_concluido_em) return { texto: 'Falta a prova', classe: 's-solicitada' }
  if (t.concluidas > 0) return { texto: `Em andamento · ${t.concluidas} de ${t.etapas} etapas`, classe: 's-liberada' }
  return { texto: 'Não iniciado', classe: '' }
}

export default function MeusTreinamentos() {
  const { empresaId } = useEmpresa()
  const [lista, setLista] = useState<Item[] | null>(null)

  useEffect(() => {
    if (!empresaId) return
    supabase.rpc('meus_treinamentos', { p_empresa: empresaId }).then(({ data }) => setLista((data as Item[] | null) ?? []))
  }, [empresaId])

  return (
    <main style={{ maxWidth: 820 }}>
      <h1>Meus treinamentos</h1>
      {lista === null && <p>Carregando…</p>}
      {lista?.length === 0 && <section className="cartao"><p>Nenhum treinamento para você por enquanto.</p></section>}
      {lista && lista.length > 0 && (
        <section className="cartao" aria-label="Treinamentos">
          {lista.map((t) => {
            const s = situacao(t)
            return (
              <div key={t.id} className="doc-linha">
                <div className="doc-topo">
                  <strong><Link to={`/meus-treinamentos/${t.id}`}>{t.titulo}</Link></strong>
                  <span className={`situacao ${s.classe}`}>{s.texto}</span>
                </div>
                {t.descricao && <small>{t.descricao}</small>}
                <small>{t.etapas} {t.etapas === 1 ? 'etapa' : 'etapas'}{t.minutos ? `, cerca de ${t.minutos} min` : ''} · prova com nota mínima {t.nota_minima}</small>
              </div>
            )
          })}
        </section>
      )}
    </main>
  )
}
