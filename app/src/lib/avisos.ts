import { useEffect, useState } from 'react'

/** Avisa as telas que a contagem mudou (ex.: avisos marcados como lidos). */
export const avisarMudanca = () => window.dispatchEvent(new Event('avisos-mudaram'))

/** Conta registros e atualiza a cada minuto, ao voltar para a aba e quando algo muda. */
export function useContagem(consulta: (() => PromiseLike<{ count: number | null }>) | null): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!consulta) return
    let vivo = true
    const contar = () => { if (navigator.onLine) void consulta().then(({ count }) => { if (vivo) setN(count ?? 0) }) }
    contar()
    const t = setInterval(contar, 60000)
    window.addEventListener('focus', contar)
    window.addEventListener('avisos-mudaram', contar)
    return () => { vivo = false; clearInterval(t); window.removeEventListener('focus', contar); window.removeEventListener('avisos-mudaram', contar) }
  }, [consulta])
  return n
}
