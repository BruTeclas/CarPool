import { useEffect, useRef, useState } from 'react'

/** Campo de assinatura desenhada com dedo, caneta ou mouse. `aoMudar` recebe o PNG, ou null quando vazio. */
export function Assinatura({ aoMudar }: { aoMudar: (png: Blob | null) => void }) {
  const tela = useRef<HTMLCanvasElement>(null)
  const desenhando = useRef(false)
  const [vazio, setVazio] = useState(true)

  useEffect(() => {
    const c = tela.current
    if (!c) return
    const escala = window.devicePixelRatio || 1
    c.width = c.clientWidth * escala
    c.height = c.clientHeight * escala
    const ctx = c.getContext('2d')!
    ctx.scale(escala, escala)
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight)
  }, [])

  function ponto(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function comecar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    desenhando.current = true
    const { x, y } = ponto(e)
    const ctx = tela.current!.getContext('2d')!
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return
    const { x, y } = ponto(e)
    const ctx = tela.current!.getContext('2d')!
    ctx.lineTo(x, y); ctx.stroke()
  }
  function terminar() {
    if (!desenhando.current) return
    desenhando.current = false
    setVazio(false)
    tela.current!.toBlob((b) => aoMudar(b), 'image/png')
  }
  function limpar() {
    const c = tela.current!
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight)
    setVazio(true)
    aoMudar(null)
  }

  return (
    <div className="assinatura">
      <canvas ref={tela} aria-label="Área para desenhar a assinatura"
        onPointerDown={comecar} onPointerMove={mover} onPointerUp={terminar} onPointerLeave={terminar} />
      <div className="acoes">
        <small>{vazio ? 'Assine dentro do quadro, com o dedo ou o mouse.' : 'Assinatura registrada.'}</small>
        <button type="button" className="secundario" onClick={limpar} disabled={vazio}>Limpar</button>
      </div>
    </div>
  )
}
