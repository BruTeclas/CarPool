import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { baixarPacote, pendentes, sincronizar } from '../lib/offline'

/** Faixa fixa que avisa quando o aparelho está sem sinal ou tem registros guardados, e envia quando o sinal volta. */
export function Sincronizador() {
  const { session } = useAuth()
  const [online, setOnline] = useState(navigator.onLine)
  const [fila, setFila] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [problemas, setProblemas] = useState<string[]>([])
  const logado = !!session

  const contar = useCallback(() => { void pendentes().then(setFila) }, [])

  const enviar = useCallback(async () => {
    if (!logado || !navigator.onLine) return
    setEnviando(true)
    const r = await sincronizar()
    setEnviando(false)
    if (r.problemas.length) setProblemas((p) => [...p, ...r.problemas])
    contar()
  }, [logado, contar])

  useEffect(() => {
    const ficouOnline = () => { setOnline(true); void enviar() }
    const ficouOffline = () => setOnline(false)
    window.addEventListener('online', ficouOnline)
    window.addEventListener('offline', ficouOffline)
    window.addEventListener('carpool-fila', contar)
    contar()
    if (logado) void baixarPacote().then(enviar)
    return () => {
      window.removeEventListener('online', ficouOnline)
      window.removeEventListener('offline', ficouOffline)
      window.removeEventListener('carpool-fila', contar)
    }
  }, [logado, contar, enviar])

  if (!logado || (online && fila === 0 && problemas.length === 0)) return null
  const plural = fila === 1 ? 'registro guardado' : 'registros guardados'

  return (
    <div className="sincronia" role="status">
      {!online && <span><strong>Sem sinal.</strong> {fila > 0 ? `${fila} ${plural} no aparelho; o envio é automático quando o sinal voltar.` : 'Você pode ler a chave e fazer a vistoria; o envio é automático quando o sinal voltar.'}</span>}
      {online && fila > 0 && (
        <span>
          {enviando ? 'Enviando registros guardados…' : `${fila} ${plural} no aparelho.`}{' '}
          {!enviando && <button type="button" className="secundario" onClick={() => void enviar()}>Enviar agora</button>}
        </span>
      )}
      {problemas.map((p) => <span key={p} className="erro">{p}</span>)}
      {online && problemas.length > 0 && <button type="button" className="secundario" onClick={() => setProblemas([])}>Entendi</button>}
    </div>
  )
}
