import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Veiculo } from '../components/Placa'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { linksAssinados, POSICOES_CHEGADA } from '../lib/fotos'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Devolucao = { id: string; fim: string; motorista_id: string; veiculos: { placa: string; modelo: string } | null }
type Avaria = { id: string; descricao: string; status: string; reserva_id: string | null; criado_em: string; veiculos: { placa: string } | null }
type Ordem = { id: string; descricao: string; criado_em: string; veiculos: { placa: string; modelo: string } | null }
type Foto = { posicao: string; caminho: string; vistorias: { tipo: string; reserva_id: string } | null }

export default function Conferencia() {
  const { empresaId, podeOperar, podeGerir } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [devolucoes, setDevolucoes] = useState<Devolucao[]>([])
  const [avarias, setAvarias] = useState<Avaria[]>([])
  const [ordens, setOrdens] = useState<Ordem[]>([])
  const [fotos, setFotos] = useState<Foto[]>([])
  const [links, setLinks] = useState<Record<string, string>>({})
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const [d, a, o] = await Promise.all([
      supabase.from('reservas').select('id, fim, motorista_id, veiculos(placa, modelo)')
        .eq('empresa_id', empresaId).eq('status', 'devolvida').order('fim').returns<Devolucao[]>(),
      supabase.from('avarias').select('id, descricao, status, reserva_id, criado_em, veiculos(placa)')
        .eq('empresa_id', empresaId).eq('status', 'aberta').order('criado_em').returns<Avaria[]>(),
      supabase.from('ordens_de_servico').select('id, descricao, criado_em, veiculos(placa, modelo)')
        .eq('empresa_id', empresaId).eq('status', 'aberta').order('criado_em').returns<Ordem[]>(),
    ])
    setDevolucoes(d.data ?? [])
    setAvarias(a.data ?? [])
    setOrdens(o.data ?? [])
    const ids = (d.data ?? []).map((r) => r.id)
    if (ids.length === 0) return setFotos([])
    const { data: f } = await supabase.from('fotos').select('posicao, caminho, vistorias!inner(tipo, reserva_id)')
      .in('vistorias.reserva_id', ids).returns<Foto[]>()
    setFotos(f ?? [])
    setLinks(await linksAssinados((f ?? []).map((x) => x.caminho)))
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  async function agir(acao: PromiseLike<{ error: { message?: string } | null }>, ok: string) {
    setMensagem(null)
    const { error } = await acao
    setMensagem(error ? { texto: mensagemDeErro(error), erro: true } : { texto: ok, erro: false })
    await carregar()
  }

  const nome = (uid: string) => pessoas.find((p) => p.valor === uid)?.rotulo ?? 'Usuário'
  const foto = (reserva: string, tipo: string, posicao: string) =>
    links[fotos.find((f) => f.vistorias?.reserva_id === reserva && f.vistorias.tipo === tipo && f.posicao === posicao)?.caminho ?? '']

  if (!podeOperar) return <main><p role="alert" className="erro">Você não tem acesso à conferência.</p></main>

  return (
    <main>
      <h1>Conferência</h1>
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}

      <h2>Devoluções a conferir</h2>
      {devolucoes.length === 0 && <p>Nenhuma devolução pendente.</p>}
      {devolucoes.map((d) => (
        <section key={d.id} className="cartao" aria-label={`Devolução ${d.veiculos?.placa}`}>
          <h3><Veiculo placa={d.veiculos?.placa} modelo={d.veiculos?.modelo} /></h3>
          <p>Motorista: {nome(d.motorista_id)}</p>
          <p>Devolução prevista: {formatarDataHora(d.fim)}. <Link to={`/reservas/${d.id}`}>Abrir reserva</Link></p>
          <ul>
            {avarias.filter((a) => a.reserva_id === d.id).map((a) => <li key={a.id}>{a.descricao}</li>)}
          </ul>
          <div className="fotos-lado">
            {POSICOES_CHEGADA.flatMap((p) => (['saida', 'chegada'] as const).map((t) => {
              const url = foto(d.id, t, p.id)
              return url ? (
                <figure key={`${p.id}-${t}`}>
                  <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${p.rotulo}, ${t === 'saida' ? 'saída' : 'chegada'}`} loading="lazy" /></a>
                  <figcaption>{p.rotulo}, {t === 'saida' ? 'saída' : 'chegada'}</figcaption>
                </figure>
              ) : null
            }))}
          </div>
          <div className="acoes" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => agir(supabase.rpc('transicionar_reserva', { p_reserva: d.id, p_para: 'encerrada', p_detalhe: { via: 'conferencia' } }), 'Reserva encerrada.')}>
              Encerrar reserva
            </button>
          </div>
        </section>
      ))}

      <section className="cartao" aria-label="Avarias abertas">
        <h2>Avarias abertas</h2>
        {avarias.length === 0 && <p>Nenhuma avaria aberta.</p>}
        <ul>
          {avarias.map((a) => (
            <li key={a.id} className="acoes" style={{ marginBottom: 8 }}>
              <span><Veiculo placa={a.veiculos?.placa} modelo={a.descricao} /> <small>{formatarDataHora(a.criado_em)}</small></span>
              {podeGerir && (
                <button type="button" className="secundario"
                  onClick={() => agir(supabase.from('avarias').update({ status: 'resolvida' }).eq('id', a.id), 'Avaria marcada como resolvida.')}>
                  Marcar como resolvida
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="cartao" aria-label="Ordens de manutenção">
        <h2>Veículos bloqueados para manutenção</h2>
        {ordens.length === 0 && <p>Nenhuma ordem aberta.</p>}
        <ul>
          {ordens.map((o) => (
            <li key={o.id} className="acoes" style={{ marginBottom: 8 }}>
              <span><Veiculo placa={o.veiculos?.placa} modelo={o.veiculos?.modelo} /> {o.descricao}</span>
              {podeGerir && (
                <button type="button" onClick={() => agir(supabase.rpc('concluir_ordem', { p_ordem: o.id }), 'Manutenção concluída. Veículo liberado.')}>
                  Concluir e liberar veículo
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
