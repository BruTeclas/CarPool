import { useEffect, useRef, useState } from 'react'

/** Mostra o PDF dentro do app, página por página, e avisa quando a pessoa chega ao fim. */
export function LeitorPdf({ url, aoChegarAoFim }: { url: string; aoChegarAoFim: () => void }) {
  const paginas = useRef<HTMLDivElement>(null)
  const fim = useRef<HTMLDivElement>(null)
  const rolagem = useRef<HTMLDivElement>(null)
  const aviso = useRef(aoChegarAoFim)
  useEffect(() => { aviso.current = aoChegarAoFim })
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando')

  useEffect(() => {
    const caixa = paginas.current
    const estado = { cancelado: false }
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const doc = await pdfjs.getDocument({ url }).promise
        const largura = Math.min(caixa?.clientWidth ?? 800, 900)
        const nitidez = Math.min(window.devicePixelRatio || 1, 2)
        for (let n = 1; n <= doc.numPages && !estado.cancelado; n++) {
          const pagina = await doc.getPage(n)
          const escala = largura / pagina.getViewport({ scale: 1 }).width
          const vista = pagina.getViewport({ scale: escala * nitidez })
          const canvas = document.createElement('canvas')
          canvas.width = vista.width
          canvas.height = vista.height
          canvas.style.width = `${vista.width / nitidez}px`
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `Página ${n} de ${doc.numPages}`)
          await pagina.render({ canvas, viewport: vista }).promise
          if (estado.cancelado) return
          caixa?.appendChild(canvas)
          if (n === 1) setEstado('pronto')
        }
      } catch {
        if (!estado.cancelado) setEstado('erro')
      }
    })()
    return () => { estado.cancelado = true; caixa?.replaceChildren() }
  }, [url])

  useEffect(() => {
    if (estado !== 'pronto' || !fim.current) return
    const o = new IntersectionObserver((itens) => { if (itens.some((i) => i.isIntersecting)) aviso.current() }, { root: rolagem.current })
    o.observe(fim.current)
    return () => o.disconnect()
  }, [estado])

  return (
    <div className="leitor-pdf" ref={rolagem} tabIndex={0} aria-label="Documento PDF">
      {estado === 'carregando' && <p>Abrindo o PDF…</p>}
      {estado === 'erro' && <p role="alert" className="erro">Não foi possível abrir o PDF. Confira a internet e tente de novo.</p>}
      <div ref={paginas} className="leitor-paginas" />
      <div ref={fim} className="leitor-fim">{estado === 'pronto' && 'Fim do documento'}</div>
    </div>
  )
}
