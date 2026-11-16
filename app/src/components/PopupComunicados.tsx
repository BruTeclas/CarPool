import { useEffect, useRef, useState } from 'react'
import { avisarMudanca } from '../lib/avisos'
import { marcarComunicado, pedeCiencia } from '../lib/comunicados'
import type { ComunicadoMeu } from '../lib/comunicados'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'
import { CorpoDoComunicado } from './Comunicado'

const MAXIMO_POR_ACESSO = 3

/** Ao abrir o app, mostra os comunicados pendentes em tela cheia, um de cada vez (no máximo 3 por acesso). */
export function PopupComunicados() {
  const { empresaId } = useEmpresa()
  const [fila, setFila] = useState<ComunicadoMeu[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(false)
  const titulo = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!empresaId) return
    supabase.rpc('comunicados_pendentes', { p_empresa: empresaId })
      .then(({ data }) => setFila(((data as ComunicadoMeu[] | null) ?? []).slice(0, MAXIMO_POR_ACESSO)))
  }, [empresaId])

  const atual = fila[0]
  useEffect(() => { titulo.current?.focus() }, [atual?.id])

  if (!atual) return null

  async function responder(ciente: boolean | null) {
    setErro(false)
    if (ciente !== null) {
      setEnviando(true)
      const { error } = await marcarComunicado(atual.id, ciente)
      setEnviando(false)
      if (error) return setErro(true)
      avisarMudanca()
    }
    setFila((f) => f.slice(1))
  }

  // "Até confirmar" e bloqueante voltam a cada acesso: fechar sem confirmar não registra nada
  const voltaAteConfirmar = atual.nivel === 'bloqueante' || atual.recorrencia === 'ate_confirmar'
  return (
    <div className="popup-fundo">
      <div className="popup" role="dialog" aria-modal="true" aria-labelledby="popup-titulo">
        <p className="popup-rotulo">Comunicado{fila.length > 1 ? ` · 1 de ${fila.length}` : ''}</p>
        <h2 id="popup-titulo" ref={titulo} tabIndex={-1}>{atual.titulo}</h2>
        <CorpoDoComunicado c={atual} />
        {atual.nivel === 'bloqueante' && <p role="note" className="popup-alerta">Enquanto você não confirmar a leitura, não consegue reservar veículos.</p>}
        {erro && <p role="alert" className="erro">Não foi possível registrar. Tente novamente.</p>}
        <div className="acoes popup-acoes">
          {pedeCiencia(atual) ? (
            <>
              <button type="button" onClick={() => responder(true)} disabled={enviando}>{enviando ? 'Registrando…' : 'Li e entendi'}</button>
              <button type="button" className="secundario" onClick={() => responder(voltaAteConfirmar ? null : false)} disabled={enviando}>Ler depois</button>
            </>
          ) : (
            <button type="button" onClick={() => responder(false)} disabled={enviando}>Fechar</button>
          )}
        </div>
      </div>
    </div>
  )
}
