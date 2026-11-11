import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useEmpresa } from '../lib/empresa'
import { supabase } from '../lib/supabase'

type Chave = { id: string; codigo: string; veiculos: { placa: string; modelo: string } | null }
type Etiqueta = Chave & { qr: string }

// Endereço gravado no QR. Em produção vem de VITE_APP_URL; trocar o domínio depois invalida as etiquetas impressas.
const BASE = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin

export default function Etiquetas() {
  const { empresaId, podeOperar } = useEmpresa()
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null)

  useEffect(() => {
    if (!empresaId || !podeOperar) return
    supabase.from('chaves').select('id, codigo, veiculos(placa, modelo)').eq('empresa_id', empresaId)
      .returns<Chave[]>().then(async ({ data }) => {
        const lista = (data ?? []).sort((a, b) => (a.veiculos?.placa ?? '').localeCompare(b.veiculos?.placa ?? ''))
        setEtiquetas(await Promise.all(lista.map(async (c) => ({
          ...c, qr: await QRCode.toDataURL(`${BASE}/k/${c.codigo}`, { margin: 1, width: 320, errorCorrectionLevel: 'M' }),
        }))))
      })
  }, [empresaId, podeOperar])

  if (!podeOperar) return <main><p role="alert" className="erro">Você não tem acesso às etiquetas.</p></main>

  return (
    <main>
      <h1>Etiquetas das chaves</h1>
      <div className="nao-imprimir">
        <p>Imprima, recorte na linha tracejada e lacre no chaveiro. O código do QR não contém a placa; a placa abaixo de cada etiqueta serve só para você saber em qual chave colar.</p>
        <p>Os QR apontam para <code>{BASE}</code>. Imprima as etiquetas definitivas só depois de publicar o sistema no endereço final.</p>
        <p><button type="button" onClick={() => window.print()}>Imprimir</button></p>
      </div>
      <section className="cartao etiquetas" aria-label="Etiquetas">
        {etiquetas?.length === 0 && <p>Nenhum veículo cadastrado.</p>}
        {etiquetas?.map((e) => (
          <div key={e.id} className="etiqueta-qr">
            <div className="recorte">
              <img src={e.qr} alt={`QR da chave do veículo ${e.veiculos?.placa}`} />
              <div>Chave {e.codigo.slice(-6).toUpperCase()}</div>
            </div>
            <small>para {e.veiculos?.placa}, {e.veiculos?.modelo}</small>
          </div>
        ))}
      </section>
    </main>
  )
}
