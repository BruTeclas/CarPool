import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Veiculo } from '../components/Placa'
import { mensagemDeErro } from '../lib/erros'
import { enviarFoto, POSICOES_CHEGADA, POSICOES_SAIDA } from '../lib/fotos'
import type { FotoEnviada } from '../lib/fotos'
import { supabase } from '../lib/supabase'

type Reserva = { id: string; empresa_id: string; status: string; veiculos: { placa: string; modelo: string; odometro_km: number } | null }
type ItemChecklist = { item: string; critico: boolean; ordem: number }
type Resposta = { ok: boolean | null; observacao: string }
type Resultado = { resultado: string; avarias?: number; bloqueado?: boolean; km_rodados?: number; itens?: string }

const NIVEIS = [{ v: 0, r: 'Reserva' }, { v: 25, r: '1/4' }, { v: 50, r: '1/2' }, { v: 75, r: '3/4' }, { v: 100, r: 'Cheio' }]

export default function Vistoria() {
  const { id = '', tipo = 'saida' } = useParams()
  const chegada = tipo === 'chegada'
  const posicoes = chegada ? POSICOES_CHEGADA : POSICOES_SAIDA
  const [reserva, setReserva] = useState<Reserva | null | undefined>(undefined)
  const [checklist, setChecklist] = useState<ItemChecklist[]>([])
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({})
  const [odometro, setOdometro] = useState('')
  const [combustivel, setCombustivel] = useState('')
  const [fotos, setFotos] = useState<Record<string, FotoEnviada>>({})
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null)
  const [avarias, setAvarias] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    supabase.from('reservas').select('id, empresa_id, status, veiculos(placa, modelo, odometro_km)')
      .eq('id', id).maybeSingle<Reserva>().then(({ data }) => {
        setReserva(data ?? null)
        if (data?.veiculos) setOdometro(String(data.veiculos.odometro_km))
      })
    supabase.rpc('checklist_padrao').then(({ data }) =>
      setChecklist(((data as ItemChecklist[]) ?? []).sort((a, b) => a.ordem - b.ordem)))
  }, [id])

  async function escolherFoto(posicao: string, arquivo: File | undefined) {
    if (!arquivo || !reserva) return
    setErro(null)
    setEnviandoFoto(posicao)
    try {
      const foto = await enviarFoto(reserva.empresa_id, reserva.id, tipo, posicao, arquivo)
      setFotos((f) => ({ ...f, [posicao]: foto }))
    } catch {
      setErro('Não foi possível enviar a foto. Verifique o sinal e tente de novo.')
    }
    setEnviandoFoto(null)
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (checklist.some((c) => respostas[c.item]?.ok == null)) return setErro('Responda todos os itens do checklist.')
    if (checklist.some((c) => respostas[c.item]?.ok === false && !respostas[c.item].observacao.trim())) {
      return setErro('Descreva o problema nos itens marcados com problema.')
    }
    if (posicoes.some((p) => !fotos[p.id])) return setErro('Faltam fotos obrigatórias. Tire todas as fotos pedidas.')
    setSalvando(true)
    const { data, error } = await supabase.rpc('registrar_vistoria', {
      p_reserva: id, p_tipo: tipo, p_odometro: Number(odometro), p_combustivel: Number(combustivel),
      p_itens: checklist.map((c) => ({ item: c.item, ok: respostas[c.item].ok, observacao: respostas[c.item].observacao })),
      p_fotos: Object.values(fotos), p_observacoes: observacoes,
      p_avarias: avarias.split('\n').map((l) => l.trim()).filter(Boolean),
    })
    setSalvando(false)
    if (error) return setErro(mensagemDeErro(error))
    setResultado(data as Resultado)
  }

  if (reserva === undefined) return <main><p>Carregando…</p></main>
  if (reserva === null) return <main><p role="alert" className="erro">Reserva não encontrada.</p></main>

  if (resultado) {
    const r = resultado.resultado
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Vistoria registrada</h1>
        <section className="cartao" aria-label="Resultado da vistoria">
          {r === 'em_uso' && <p role="status" className="sucesso"><strong>Tudo certo, boa viagem.</strong> Na volta, leia a chave de novo ou abra a reserva para fazer a vistoria de chegada.</p>}
          {r === 'veiculo_bloqueado' && <p role="alert" className="erro"><strong>Não saia com este veículo.</strong> Item crítico reprovado ({resultado.itens}). O carro foi bloqueado, a manutenção foi avisada e sua reserva foi cancelada sem penalidade. Devolva a chave e reserve outro veículo.</p>}
          {r === 'encerrada' && <p role="status" className="sucesso"><strong>Devolução concluída.</strong> Você rodou {resultado.km_rodados} km. Devolva a chave no local combinado.</p>}
          {r === 'devolvida' && <p role="status"><strong>Devolução registrada.</strong> Você rodou {resultado.km_rodados} km. {resultado.avarias ? `${resultado.avarias} avaria(s) foram registradas` : 'Um item crítico foi reprovado'} e o gestor vai conferir antes de encerrar. Devolva a chave no local combinado.</p>}
          <p>{r === 'veiculo_bloqueado' ? <Link to="/reservar">Reservar outro veículo</Link> : <Link to={`/reservas/${id}`}>Ver a reserva</Link>}</p>
        </section>
      </main>
    )
  }

  const esperado = chegada ? ['em_uso', 'atrasada'] : ['liberada']
  if (!esperado.includes(reserva.status)) {
    return (
      <main><p role="alert" className="erro">Essa vistoria não pode ser feita agora. Confira a situação da reserva.</p>
        <Link to={`/reservas/${id}`}>Ver a reserva</Link></main>
    )
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <h1>Vistoria de {chegada ? 'chegada' : 'saída'}</h1>
      <p><Veiculo placa={reserva.veiculos?.placa} modelo={reserva.veiculos?.modelo} /></p>
      <form onSubmit={salvar}>
        <section className="cartao" aria-label="Checklist">
          <h2>Checklist</h2>
          {checklist.map((c) => {
            const r = respostas[c.item] ?? { ok: null, observacao: '' }
            return (
              <fieldset key={c.item} className="item-checklist">
                <legend>{c.item}{c.critico && <span className="etiqueta"> item de segurança</span>}</legend>
                <label className="linha"><input type="radio" name={c.item} checked={r.ok === true}
                  onChange={() => setRespostas({ ...respostas, [c.item]: { ok: true, observacao: '' } })} /> OK</label>
                <label className="linha"><input type="radio" name={c.item} checked={r.ok === false}
                  onChange={() => setRespostas({ ...respostas, [c.item]: { ...r, ok: false } })} /> Com problema</label>
                {r.ok === false && (
                  <label>O que há de errado em {c.item.toLowerCase()}?
                    <input value={r.observacao} onChange={(e) => setRespostas({ ...respostas, [c.item]: { ok: false, observacao: e.target.value } })} />
                  </label>
                )}
              </fieldset>
            )
          })}
        </section>
        <section className="cartao" aria-label="Odômetro e combustível">
          <h2>Odômetro e combustível</h2>
          <div className="form-grade" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <label>Odômetro (km)
              <input type="number" inputMode="numeric" required min={reserva.veiculos?.odometro_km ?? 0} value={odometro} onChange={(e) => setOdometro(e.target.value)} />
            </label>
            <label>Combustível
              <select required value={combustivel} onChange={(e) => setCombustivel(e.target.value)}>
                <option value="">Selecione…</option>
                {NIVEIS.map((n) => <option key={n.v} value={n.v}>{n.r}</option>)}
              </select>
            </label>
          </div>
        </section>
        <section className="cartao" aria-label="Fotos">
          <h2>Fotos</h2>
          <p>Tire uma foto de cada posição. Elas ficam registradas com data, hora e local.</p>
          {posicoes.map((p) => (
            <label key={p.id} className="foto">
              <span>{p.rotulo} {fotos[p.id] ? <strong className="sucesso">✓ enviada</strong> : enviandoFoto === p.id ? 'enviando…' : ''}</span>
              <input type="file" accept="image/*" capture="environment" aria-label={`Foto: ${p.rotulo}`}
                disabled={enviandoFoto !== null} onChange={(e) => escolherFoto(p.id, e.target.files?.[0])} />
            </label>
          ))}
        </section>
        <section className="cartao" aria-label="Observações">
          {chegada && (
            <label>Avarias novas (uma por linha; deixe em branco se não houver)
              <textarea rows={3} value={avarias} onChange={(e) => setAvarias(e.target.value)} />
            </label>
          )}
          <label>Observações (opcional)
            <textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </label>
        </section>
        {erro && <p role="alert" className="erro">{erro}</p>}
        <button type="submit" disabled={salvando || enviandoFoto !== null}>{salvando ? 'Salvando…' : `Concluir vistoria de ${chegada ? 'chegada' : 'saída'}`}</button>
      </form>
    </main>
  )
}
