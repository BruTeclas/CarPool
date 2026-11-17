import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useEmpresa } from '../lib/empresa'
import { PERFIS } from '../lib/perfis'
import { supabase } from '../lib/supabase'
import { BLOQUEIOS } from '../lib/treinamentos'
import type { Treinamento } from '../lib/treinamentos'

type Opcao = { id: string; nome: string }

/** Para quem o treinamento vale, se é obrigatório, prazo e validade. Pode mudar mesmo depois de publicado. */
export function RegrasTreinamento({ t, aoSalvar }: { t: Treinamento; aoSalvar: () => Promise<void> }) {
  const { empresaId } = useEmpresa()
  const [grupos, setGrupos] = useState<Opcao[]>([])
  const [filiais, setFiliais] = useState<Opcao[]>([])
  const [perfis, setPerfis] = useState<string[]>(t.publico_perfis ?? [])
  const [gruposSel, setGruposSel] = useState<string[]>(t.publico_grupos ?? [])
  const [unidade, setUnidade] = useState(t.unidade_id ?? '')
  const [bloqueio, setBloqueio] = useState(t.bloqueio)
  const [prazo, setPrazo] = useState(String(t.prazo_dias))
  const [vence, setVence] = useState(t.validade_meses !== null)
  const [meses, setMeses] = useState(String(t.validade_meses ?? 12))
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null)

  useEffect(() => {
    if (!empresaId) return
    void Promise.all([
      supabase.from('grupos').select('id, nome').eq('empresa_id', empresaId).order('nome').returns<Opcao[]>(),
      supabase.from('unidades').select('id, nome').eq('empresa_id', empresaId).order('nome').returns<Opcao[]>(),
    ]).then(([g, u]) => { setGrupos(g.data ?? []); setFiliais(u.data ?? []) })
  }, [empresaId])

  const alterna = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (t.publicado_em && bloqueio !== 'nenhum' && t.bloqueio === 'nenhum'
        && !window.confirm('Tornar este treinamento obrigatório? Quem está no público e ainda não foi aprovado será cobrado a partir de agora, com o prazo escolhido.')) return
    const { error } = await supabase.from('treinamentos').update({
      publico_perfis: perfis.length ? perfis : null, publico_grupos: gruposSel.length ? gruposSel : null, unidade_id: unidade || null,
      bloqueio, prazo_dias: Number(prazo), validade_meses: vence ? Number(meses) : null,
    }).eq('id', t.id)
    if (error) return setMsg({ texto: 'Não foi possível salvar. O prazo vai de 0 a 365 dias e a validade de 1 a 120 meses.', erro: true })
    await aoSalvar()
    setMsg({ texto: 'Regras salvas.', erro: false })
  }

  return (
    <section className="cartao" aria-label="Para quem e obrigatoriedade">
      <h2>Para quem e obrigatoriedade</h2>
      <p>Estas regras podem mudar a qualquer momento, mesmo depois de publicado.</p>
      <form onSubmit={salvar} style={{ display: 'grid', gap: 16 }}>
        <fieldset>
          <legend>Público</legend>
          <p><small>Sem marcar nada, vale para todos. As escolhas se somam: “motoristas” + “filial X” = motoristas da filial X. Quem entrar depois no público recebe o treinamento automaticamente.</small></p>
          <div className="opcoes-linha">
            {PERFIS.map((p) => <label key={p.valor}><input type="checkbox" checked={perfis.includes(p.valor)} onChange={() => setPerfis(alterna(perfis, p.valor))} />{p.rotulo}</label>)}
          </div>
          {grupos.length > 0 && (
            <div className="opcoes-linha" style={{ marginTop: 8 }} aria-label="Grupos">
              {grupos.map((g) => <label key={g.id}><input type="checkbox" checked={gruposSel.includes(g.id)} onChange={() => setGruposSel(alterna(gruposSel, g.id))} />Grupo {g.nome}</label>)}
            </div>
          )}
          <label style={{ maxWidth: 360, marginTop: 8 }}>Filial
            <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
              <option value="">Todas as filiais</option>
              {filiais.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Obrigatoriedade</legend>
          {(Object.keys(BLOQUEIOS) as Treinamento['bloqueio'][]).map((b) => (
            <label key={b} className="linha"><input type="radio" name="bloqueio" checked={bloqueio === b} onChange={() => setBloqueio(b)} />
              <span><strong>{BLOQUEIOS[b].rotulo}.</strong> {BLOQUEIOS[b].ajuda}</span>
            </label>
          ))}
          {bloqueio !== 'nenhum' && (
            <label style={{ maxWidth: 360 }}>Prazo para fazer (dias)
              <input type="number" min={0} max={365} required value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              <small>Conta da publicação, ou da entrada da pessoa na empresa, se for depois. Com 0, bloqueia na hora (bom para onboarding).</small>
            </label>
          )}
        </fieldset>
        <fieldset>
          <legend>Validade (reciclagem)</legend>
          <label className="linha"><input type="checkbox" checked={vence} onChange={(e) => setVence(e.target.checked)} />A aprovação vence e precisa ser refeita</label>
          {vence && (
            <label style={{ maxWidth: 360 }}>Vale por (meses)
              <input type="number" min={1} max={120} required value={meses} onChange={(e) => setMeses(e.target.value)} />
              <small>A pessoa é avisada 30, 7 e 1 dia antes. Ao vencer, refaz o conteúdo e a prova.</small>
            </label>
          )}
        </fieldset>
        <div className="acoes"><button type="submit">Salvar regras</button></div>
        {msg && <p role={msg.erro ? 'alert' : 'status'} className={msg.erro ? 'erro' : 'sucesso'}>{msg.texto}</p>}
      </form>
    </section>
  )
}
