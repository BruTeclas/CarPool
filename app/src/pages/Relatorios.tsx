import { useCallback, useEffect, useMemo, useState } from 'react'
import { Placa } from '../components/Placa'
import { baixarCsv, gerarCsv } from '../lib/csv'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { useOpcoes } from '../lib/opcoes'
import { rotuloStatus } from '../lib/status'
import { supabase } from '../lib/supabase'

type PorVeiculo = {
  placa: string; modelo: string; categoria: string; base: string; parado_h: number; reservado_h: number
  usado_h: number; km: number; viagens: number; utilizacao_pct: number; ocupacao_pct: number
}
type Resumo = {
  frota: number; horas_periodo: number; utilizacao_pct: number; ocupacao_pct: number; disponibilidade_pct: number
  reservas: number; usadas: number; no_show: number; canceladas: number; cancelamentos_tardios: number
  atrasadas: number; atraso_medio_min: number | null; km: number; incidentes: number; pico: number; pico_em: string | null
}
type Relatorio = { resumo: Resumo; veiculos: PorVeiculo[]; demanda: { total: number; pessoas: number; por_categoria: { categoria: string; buscas: number }[] } }
type LinhaReserva = {
  data: string; motorista: string | null; placa: string; modelo: string; categoria: string; base: string; centro_de_custo: string
  finalidade: string | null; destino: string | null; inicio: string; fim: string; retirada: string | null; devolucao: string | null
  horas_usadas: number | null; km: number | null; situacao: string; atrasou: boolean
}

const hoje = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function periodo(chave: string): [string, string] {
  const h = hoje()
  if (chave === '7') return [iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6)), iso(h)]
  if (chave === 'mes') return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)]
  if (chave === 'mes_passado') return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]
  return [iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 29)), iso(h)]
}
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

function diagnostico(r: Relatorio): string {
  const { resumo: s, demanda: d } = r
  if (s.frota === 0) return 'Nenhum veículo no filtro escolhido.'
  if (s.pico >= s.frota && d.total > 0)
    return `A frota chegou ao limite: no pico, os ${s.frota} carros estavam reservados ao mesmo tempo, e ${d.total} busca${d.total > 1 ? 's' : ''} não encontrou carro livre. Vale aumentar a frota ou espalhar os horários.`
  if (d.total > 0)
    return `Houve ${d.total} busca${d.total > 1 ? 's' : ''} sem carro livre, mas no pico só ${s.pico} de ${s.frota} carros estavam reservados. A falta pode ser de uma categoria ou filial específica, não da frota toda.`
  if (s.frota - s.pico >= 2 && s.utilizacao_pct < 25)
    return `A frota parece maior que a necessidade: utilização de ${pct(s.utilizacao_pct)} e, mesmo no pico, ${s.frota - s.pico} carros ficaram sem reserva.`
  return 'A frota atendeu a demanda do período sem sobra evidente.'
}

export default function Relatorios() {
  const { empresaId, empresaNome, podeVerRelatorios } = useEmpresa()
  const unidades = useOpcoes('unidades', 'id', 'nome', empresaId)
  const [preset, setPreset] = useState('30')
  const [[de, ate], setPeriodo] = useState<[string, string]>(() => periodo('30'))
  const [unidade, setUnidade] = useState('')
  const [rel, setRel] = useState<Relatorio | null>(null)
  const [linhas, setLinhas] = useState<LinhaReserva[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId || !de || !ate) return
    setCarregando(true); setErro(null)
    const args = { p_empresa: empresaId, p_inicio: de, p_fim: ate, p_unidade: unidade || null }
    const [r, l] = await Promise.all([supabase.rpc('relatorio_frota', args), supabase.rpc('relatorio_reservas', args)])
    setCarregando(false)
    if (r.error || l.error) { setErro(mensagemDeErro(r.error ?? l.error)); return }
    setRel(r.data as Relatorio)
    setLinhas((l.data as LinhaReserva[]) ?? [])
  }, [empresaId, de, ate, unidade])

  useEffect(() => { void carregar() }, [carregar])

  const porCentro = useMemo(() => {
    const m = new Map<string, { reservas: number; usadas: number; horas: number; km: number }>()
    for (const l of linhas) {
      const c = m.get(l.centro_de_custo) ?? { reservas: 0, usadas: 0, horas: 0, km: 0 }
      c.reservas++; if (l.retirada) c.usadas++; c.horas += l.horas_usadas ?? 0; c.km += l.km ?? 0
      m.set(l.centro_de_custo, c)
    }
    return [...m.entries()].sort((a, b) => b[1].horas - a[1].horas)
  }, [linhas])

  function baixarReservas() {
    baixarCsv(`reservas_${de}_a_${ate}.csv`, gerarCsv(linhas, [
      { titulo: 'Data', valor: (l) => l.data.split('-').reverse().join('/') }, { titulo: 'Centro de custo', valor: (l) => l.centro_de_custo },
      { titulo: 'Motorista', valor: (l) => l.motorista }, { titulo: 'Placa', valor: (l) => l.placa }, { titulo: 'Modelo', valor: (l) => l.modelo },
      { titulo: 'Categoria', valor: (l) => l.categoria }, { titulo: 'Base', valor: (l) => l.base },
      { titulo: 'Finalidade', valor: (l) => l.finalidade }, { titulo: 'Destino', valor: (l) => l.destino },
      { titulo: 'Retirada prevista', valor: (l) => formatarDataHora(l.inicio) }, { titulo: 'Devolução prevista', valor: (l) => formatarDataHora(l.fim) },
      { titulo: 'Retirada real', valor: (l) => (l.retirada ? formatarDataHora(l.retirada) : '') },
      { titulo: 'Devolução real', valor: (l) => (l.devolucao ? formatarDataHora(l.devolucao) : '') },
      { titulo: 'Horas de uso', valor: (l) => l.horas_usadas }, { titulo: 'Km rodados', valor: (l) => l.km },
      { titulo: 'Situação', valor: (l) => rotuloStatus(l.situacao) }, { titulo: 'Atrasou', valor: (l) => l.atrasou },
    ]))
  }
  function baixarVeiculos() {
    if (!rel) return
    baixarCsv(`uso_por_veiculo_${de}_a_${ate}.csv`, gerarCsv(rel.veiculos, [
      { titulo: 'Placa', valor: (v) => v.placa }, { titulo: 'Modelo', valor: (v) => v.modelo }, { titulo: 'Categoria', valor: (v) => v.categoria },
      { titulo: 'Base', valor: (v) => v.base }, { titulo: 'Utilização (%)', valor: (v) => v.utilizacao_pct }, { titulo: 'Ocupação (%)', valor: (v) => v.ocupacao_pct },
      { titulo: 'Horas em uso', valor: (v) => v.usado_h }, { titulo: 'Horas reservadas', valor: (v) => v.reservado_h },
      { titulo: 'Horas parado (oficina ou ocorrência)', valor: (v) => v.parado_h }, { titulo: 'Viagens', valor: (v) => v.viagens }, { titulo: 'Km', valor: (v) => v.km },
    ]))
  }

  if (!podeVerRelatorios) return <main><p role="alert" className="erro">Você não tem acesso aos relatórios.</p></main>
  const s = rel?.resumo
  const maior = Math.max(1, ...(rel?.veiculos ?? []).map((v) => v.utilizacao_pct))

  return (
    <main>
      <h1>Relatórios</h1>
      <section className="cartao filtros" aria-label="Filtros">
        <div className="segmentos" role="group" aria-label="Período">
          {[['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado']].map(([k, r]) => (
            <button key={k} type="button" aria-pressed={preset === k} className={preset === k ? 'ativo' : ''}
              onClick={() => { setPreset(k); setPeriodo(periodo(k)) }}>{r}</button>
          ))}
        </div>
        <label>De<input type="date" value={de} onChange={(e) => { setPreset(''); setPeriodo([e.target.value, ate]) }} /></label>
        <label>Até<input type="date" value={ate} onChange={(e) => { setPreset(''); setPeriodo([de, e.target.value]) }} /></label>
        <label>Filial
          <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.valor} value={u.valor}>{u.rotulo}</option>)}
          </select>
        </label>
      </section>
      {erro && <p role="alert" className="erro">{erro}</p>}
      {carregando && !rel && <p>Carregando…</p>}
      {rel && s && (
        <>
          <p className="diagnostico" role="status">{diagnostico(rel)}</p>
          <section className="indicadores" aria-label="Indicadores">
            <div className="indicador"><span>Utilização</span><strong>{pct(s.utilizacao_pct)}</strong><small>do tempo disponível, com o carro na rua</small></div>
            <div className="indicador"><span>Ocupação</span><strong>{pct(s.ocupacao_pct)}</strong><small>do tempo disponível, reservado</small></div>
            <div className="indicador"><span>Pico simultâneo</span><strong>{s.pico} de {s.frota}</strong><small>{s.pico_em ? `em ${formatarDataHora(s.pico_em)}` : 'sem reservas no período'}</small></div>
            <div className="indicador"><span>Disponibilidade</span><strong>{pct(s.disponibilidade_pct)}</strong><small>fora de oficina e ocorrências</small></div>
            <div className="indicador"><span>Demanda não atendida</span><strong>{rel.demanda.total}</strong><small>{rel.demanda.total ? `buscas sem carro, de ${rel.demanda.pessoas} pessoa${rel.demanda.pessoas > 1 ? 's' : ''}` : 'nenhuma busca ficou sem carro'}</small></div>
            <div className="indicador"><span>Não retiradas</span><strong>{s.no_show}</strong><small>{s.reservas ? `${pct((100 * s.no_show) / s.reservas)} das ${s.reservas} reservas` : 'sem reservas'}{s.cancelamentos_tardios ? `; ${s.cancelamentos_tardios} cancelamento${s.cancelamentos_tardios > 1 ? 's' : ''} fora do prazo` : ''}</small></div>
            <div className="indicador"><span>Atrasos</span><strong>{s.atrasadas}</strong><small>{s.usadas ? `${pct((100 * s.atrasadas) / s.usadas)} das viagens${s.atraso_medio_min ? `, ${s.atraso_medio_min} min em média` : ''}` : 'sem viagens'}</small></div>
            <div className="indicador"><span>Km rodados</span><strong>{num(s.km)}</strong><small>{s.usadas} viage{s.usadas === 1 ? 'm' : 'ns'}{s.incidentes ? `; ${s.incidentes} pane${s.incidentes > 1 ? 's ou acidentes' : ' ou acidente'}` : ''}</small></div>
          </section>

          <section className="cartao" aria-label="Uso por veículo">
            <div className="doc-topo"><h2 style={{ margin: 0 }}>Utilização por veículo</h2>
              <button type="button" className="secundario" onClick={baixarVeiculos} disabled={!rel.veiculos.length}>Baixar CSV</button></div>
            <ul className="barras" aria-label="Utilização por veículo, em porcentagem do tempo disponível">
              {rel.veiculos.map((v) => (
                <li key={v.placa} title={`${v.placa}: ${pct(v.utilizacao_pct)} em uso, ${pct(v.ocupacao_pct)} reservado, ${num(v.parado_h)} h parado`}>
                  <span className="barra-rotulo"><Placa valor={v.placa} /> {v.modelo}</span>
                  <span className="barra-trilho"><span className="barra" style={{ width: `${(100 * v.utilizacao_pct) / maior}%` }} /></span>
                  <span className="barra-valor">{pct(v.utilizacao_pct)}</span>
                </li>
              ))}
            </ul>
            <div className="tabela-rolagem">
              <table>
                <thead><tr><th>Veículo</th><th>Base</th><th>Em uso</th><th>Reservado</th><th>Parado</th><th>Viagens</th><th>Km</th></tr></thead>
                <tbody>
                  {rel.veiculos.map((v) => (
                    <tr key={v.placa}><td><Placa valor={v.placa} /> {v.modelo}</td><td>{v.base}</td><td>{num(v.usado_h)} h</td>
                      <td>{num(v.reservado_h)} h</td><td>{num(v.parado_h)} h</td><td>{v.viagens}</td><td>{num(v.km)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="cartao" aria-label="Por centro de custo">
            <div className="doc-topo"><h2 style={{ margin: 0 }}>Por centro de custo</h2>
              <button type="button" onClick={baixarReservas} disabled={!linhas.length}>Baixar reservas (CSV)</button></div>
            {porCentro.length === 0 ? <p>Nenhuma reserva no período.</p> : (
              <div className="tabela-rolagem">
                <table>
                  <thead><tr><th>Centro de custo</th><th>Reservas</th><th>Usadas</th><th>Horas de uso</th><th>Km</th></tr></thead>
                  <tbody>
                    {porCentro.map(([c, v]) => <tr key={c}><td>{c}</td><td>{v.reservas}</td><td>{v.usadas}</td><td>{num(v.horas)} h</td><td>{num(v.km)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
            <p className="nota" style={{ margin: '12px 0 0' }}>O arquivo traz uma linha por reserva, com horários previstos e reais, km e centro de custo, para {empresaNome || 'a empresa'}. Abre direto no Excel.</p>
          </section>

          {rel.demanda.por_categoria.length > 0 && (
            <section className="cartao" aria-label="Demanda não atendida por categoria">
              <h2>Buscas sem carro, por categoria</h2>
              <ul>{rel.demanda.por_categoria.map((c) => <li key={c.categoria}>{c.categoria}: {c.buscas}</li>)}</ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
