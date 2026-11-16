import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Placa } from '../components/Placa'
import { avisarMudanca } from '../lib/avisos'
import { formatarDataHora } from '../lib/datas'
import { useEmpresa } from '../lib/empresa'
import { mensagemDeErro } from '../lib/erros'
import { linksAssinados } from '../lib/fotos'
import { rotuloOcorrencia } from '../lib/ocorrencias'
import { useOpcoes } from '../lib/opcoes'
import { supabase } from '../lib/supabase'

type Incidente = {
  id: string; reserva_id: string; user_id: string; tipo: string; descricao: string | null; endereco: string | null
  latitude: number | null; longitude: number | null; precisao_m: number | null; fotos: { caminho: string }[]
  registrada_em: string; status: string; local_veiculo: string | null; encerrada_em: string | null
  veiculos: { placa: string; modelo: string } | null
}
const SITUACOES = [
  { valor: 'manutencao', rotulo: 'Em manutenção' }, { valor: 'bloqueado', rotulo: 'Bloqueado' }, { valor: 'ativo', rotulo: 'Liberado para uso' },
]

function Encerrar({ inc, aoEncerrar }: { inc: Incidente; aoEncerrar: (msg: string, erro: boolean) => void }) {
  const [local, setLocal] = useState('')
  const [km, setKm] = useState('')
  const [obs, setObs] = useState('')
  const [situacao, setSituacao] = useState('manutencao')
  async function enviar(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('encerrar_ocorrencia', {
      p_ocorrencia: inc.id, p_local_veiculo: local, p_odometro_km: km ? Number(km) : null, p_observacao: obs || null, p_status_veiculo: situacao,
    })
    aoEncerrar(error ? mensagemDeErro(error) : 'Ocorrência encerrada e reserva finalizada.', !!error)
  }
  return (
    <form onSubmit={enviar} className="form-grade" aria-label={`Encerrar ocorrência do ${inc.veiculos?.placa ?? 'veículo'}`}>
      <label>Onde o carro está agora
        <input required value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Oficina, guincho, delegacia, pátio" />
      </label>
      <label>Odômetro (km, se souber)
        <input type="number" min={0} value={km} onChange={(e) => setKm(e.target.value)} />
      </label>
      <label>Situação do carro
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>
      </label>
      <label>Observação
        <input value={obs} onChange={(e) => setObs(e.target.value)} />
      </label>
      <div className="acoes"><button type="submit">Encerrar ocorrência</button></div>
    </form>
  )
}

export default function Incidentes() {
  const { empresaId, podeOperar } = useEmpresa()
  const pessoas = useOpcoes('membros', 'user_id', 'nome', empresaId)
  const [abertos, setAbertos] = useState<Incidente[]>([])
  const [encerrados, setEncerrados] = useState<Incidente[]>([])
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    const campos = 'id, reserva_id, user_id, tipo, descricao, endereco, latitude, longitude, precisao_m, fotos, registrada_em, status, local_veiculo, encerrada_em, veiculos(placa, modelo)'
    const [a, e] = await Promise.all([
      supabase.from('incidentes').select(campos).eq('empresa_id', empresaId).eq('status', 'aberta').order('registrada_em').returns<Incidente[]>(),
      supabase.from('incidentes').select(campos).eq('empresa_id', empresaId).eq('status', 'encerrada').order('encerrada_em', { ascending: false }).limit(20).returns<Incidente[]>(),
    ])
    setAbertos(a.data ?? [])
    setEncerrados(e.data ?? [])
    setFotos(await linksAssinados((a.data ?? []).flatMap((i) => i.fotos.map((f) => f.caminho))))
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  const nome = (uid: string) => pessoas.find((p) => p.valor === uid)?.rotulo ?? 'Motorista'
  if (!podeOperar) return <main><p role="alert" className="erro">Você não tem acesso às ocorrências.</p></main>

  return (
    <main>
      <h1>Ocorrências</h1>
      {mensagem && <p role={mensagem.erro ? 'alert' : 'status'} className={mensagem.erro ? 'erro' : 'sucesso'}>{mensagem.texto}</p>}
      <section className="cartao" aria-label="Em aberto">
        <h2>Em aberto</h2>
        {abertos.length === 0 && <p>Nenhuma pane ou acidente em aberto.</p>}
        {abertos.map((i) => (
          <article key={i.id} className={`doc-linha incidente${i.tipo === 'acidente_com_vitima' ? ' grave' : ''}`}>
            <div className="doc-topo">
              <strong>{rotuloOcorrencia(i.tipo)}</strong>
              <span><Placa valor={i.veiculos?.placa} /></span>
            </div>
            <p style={{ margin: 0 }}>{nome(i.user_id)}, {formatarDataHora(i.registrada_em)}</p>
            {i.endereco && <p style={{ margin: 0 }}>Local informado: {i.endereco}</p>}
            {i.latitude !== null && i.longitude !== null && (
              <p style={{ margin: 0 }}>
                <a href={`https://www.google.com/maps?q=${i.latitude},${i.longitude}`} target="_blank" rel="noreferrer">Abrir a localização no mapa</a>
                {i.precisao_m ? ` (precisão de ${i.precisao_m} m)` : ''}
              </p>
            )}
            {i.descricao && <p style={{ margin: 0 }}>{i.descricao}</p>}
            {i.fotos.length > 0 && (
              <div className="miniaturas">
                {i.fotos.map((f) => fotos[f.caminho] && <a key={f.caminho} href={fotos[f.caminho]} target="_blank" rel="noreferrer"><img src={fotos[f.caminho]} alt="Foto da ocorrência" /></a>)}
              </div>
            )}
            <p style={{ margin: 0 }}><Link to={`/reservas/${i.reserva_id}`}>Ver a reserva</Link></p>
            <Encerrar inc={i} aoEncerrar={(texto, erro) => { setMensagem({ texto, erro }); avisarMudanca(); void carregar() }} />
          </article>
        ))}
      </section>
      <section className="cartao" aria-label="Encerradas">
        <h2>Encerradas recentemente</h2>
        {encerrados.length === 0 && <p>Nenhuma ainda.</p>}
        {encerrados.length > 0 && (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Ocorrência</th><th>Veículo</th><th>Motorista</th><th>Encerrada</th><th>Onde ficou o carro</th></tr></thead>
              <tbody>
                {encerrados.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/reservas/${i.reserva_id}`}>{rotuloOcorrencia(i.tipo)}</Link></td>
                    <td><Placa valor={i.veiculos?.placa} /></td>
                    <td>{nome(i.user_id)}</td>
                    <td>{i.encerrada_em ? formatarDataHora(i.encerrada_em) : ''}</td>
                    <td>{i.local_veiculo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
