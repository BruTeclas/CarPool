import { useEffect, useMemo, useState } from 'react'
import { baixarCsv, gerarCsv } from '../lib/csv'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'
import { baixarCertificado, dataCurta, duracao, SITUACOES } from '../lib/treinamentos'
import type { LinhaAcompanhamento, Situacao, Treinamento } from '../lib/treinamentos'

const ORDEM: Situacao[] = ['atrasado', 'vencido', 'aguardando_correcao', 'vencendo', 'em_andamento', 'nao_iniciado', 'aprovado']

export function colunasDoResultado(titulo: string) {
  return [
    { titulo: 'Treinamento', valor: () => titulo },
    { titulo: 'Pessoa', valor: (l: LinhaAcompanhamento) => l.nome },
    { titulo: 'Situação', valor: (l: LinhaAcompanhamento) => SITUACOES[l.situacao].rotulo },
    { titulo: 'Etapas concluídas', valor: (l: LinhaAcompanhamento) => `${l.etapas_concluidas} de ${l.etapas}` },
    { titulo: 'Tempo de estudo (min)', valor: (l: LinhaAcompanhamento) => Math.round(l.segundos / 6) / 10 },
    { titulo: 'Tentativas', valor: (l: LinhaAcompanhamento) => l.tentativas },
    { titulo: 'Última nota', valor: (l: LinhaAcompanhamento) => l.ultima_nota },
    { titulo: 'Aprovado em', valor: (l: LinhaAcompanhamento) => dataCurta(l.aprovado_em) },
    { titulo: 'Válido até', valor: (l: LinhaAcompanhamento) => dataCurta(l.valido_ate) },
    { titulo: 'Prazo', valor: (l: LinhaAcompanhamento) => (l.aprovado_em ? '' : dataCurta(l.prazo_ate)) },
  ]
}

export function AcompanhamentoTreinamento({ t }: { t: Treinamento }) {
  const [linhas, setLinhas] = useState<LinhaAcompanhamento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Situacao | ''>('')

  useEffect(() => {
    supabase.rpc('acompanhamento_treinamento', { p_treinamento: t.id }).then(({ data, error }) => {
      if (error) setErro(mensagemDeErro(error))
      else setLinhas(((data as LinhaAcompanhamento[]) ?? []).sort((a, b) => ORDEM.indexOf(a.situacao) - ORDEM.indexOf(b.situacao)))
    })
  }, [t.id])

  const contagem = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {}
    for (const l of linhas ?? []) c[l.situacao] = (c[l.situacao] ?? 0) + 1
    return c
  }, [linhas])

  async function certificado(l: LinhaAcompanhamento) {
    const e = await baixarCertificado(t.id, l.user_id)
    if (e) setErro(mensagemDeErro({ message: e }))
  }

  const vistas = (linhas ?? []).filter((l) => !filtro || l.situacao === filtro)
  return (
    <section className="cartao" aria-label="Acompanhamento">
      <h2>Acompanhamento</h2>
      {erro && <p role="alert" className="erro">{erro}</p>}
      {linhas === null && !erro && <p>Carregando…</p>}
      {linhas && (
        <>
          <p>{linhas.length} {linhas.length === 1 ? 'pessoa' : 'pessoas'} no público. A aprovação em qualquer versão deste treinamento vale.</p>
          <div className="filtros" role="group" aria-label="Filtrar por situação">
            <button type="button" className={filtro ? 'secundario' : ''} aria-pressed={!filtro} onClick={() => setFiltro('')}>Todos ({linhas.length})</button>
            {ORDEM.filter((s) => contagem[s]).map((s) => (
              <button key={s} type="button" className={filtro === s ? '' : 'secundario'} aria-pressed={filtro === s} onClick={() => setFiltro(s)}>{SITUACOES[s].rotulo} ({contagem[s]})</button>
            ))}
          </div>
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Pessoa</th><th>Situação</th><th>Etapas</th><th>Tempo de estudo</th><th>Tentativas</th><th>Nota</th><th>Prazo ou validade</th><th><span className="so-leitor">Certificado</span></th></tr></thead>
              <tbody>
                {vistas.length === 0 && <tr><td colSpan={8} className="vazio">Ninguém nesta situação.</td></tr>}
                {vistas.map((l) => (
                  <tr key={l.user_id}>
                    <td>{l.nome ?? 'Sem nome'}</td>
                    <td><span className={`situacao ${SITUACOES[l.situacao].classe}`}>{SITUACOES[l.situacao].rotulo}</span></td>
                    <td>{l.etapas_concluidas} de {l.etapas}</td>
                    <td>{l.segundos ? duracao(l.segundos) : '—'}</td>
                    <td>{l.tentativas}</td>
                    <td>{l.ultima_nota !== null ? Number(l.ultima_nota).toLocaleString('pt-BR') : '—'}</td>
                    <td>{l.aprovado_em ? (l.valido_ate ? `vale até ${dataCurta(l.valido_ate)}` : 'não vence') : l.prazo_ate ? `até ${dataCurta(l.prazo_ate)}` : '—'}</td>
                    <td>{l.aprovado_em && <button type="button" className="secundario" onClick={() => certificado(l)}>Certificado</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="acoes">
            <button type="button" className="secundario" onClick={() => baixarCsv(`treinamento-${t.titulo.slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`, gerarCsv(linhas, colunasDoResultado(t.titulo)))}>Baixar planilha (CSV)</button>
          </div>
        </>
      )}
    </section>
  )
}
