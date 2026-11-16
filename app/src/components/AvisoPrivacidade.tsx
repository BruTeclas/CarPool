import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useEmpresa } from '../lib/empresa'
import type { AvisoPrivacidade } from '../lib/privacidade'
import { supabase } from '../lib/supabase'

/** Mostra o aviso de privacidade vigente até a pessoa dar ciência; depois libera o conteúdo. */
export function PortaoDePrivacidade({ children }: { children: ReactNode }) {
  const { empresaId, empresaNome, carregando } = useEmpresa()
  const [aviso, setAviso] = useState<AvisoPrivacidade | null | undefined>(undefined)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    if (!empresaId) return
    supabase.rpc('aviso_privacidade_pendente', { p_empresa: empresaId })
      .then(({ data, error }) => setAviso(error ? null : (data as AvisoPrivacidade | null)))
  }, [empresaId])

  async function darCiencia() {
    if (!aviso) return
    setEnviando(true)
    setErro(false)
    const { error } = await supabase.rpc('dar_ciencia_privacidade', { p_aviso: aviso.id })
    setEnviando(false)
    if (error) return setErro(true)
    setAviso(null)
  }

  if (carregando) return null
  if (!empresaId || aviso === null) return <>{children}</>
  if (aviso === undefined) return null
  return (
    <main>
      <h1>Como tratamos seus dados</h1>
      <p>Antes de continuar, leia o aviso de privacidade de {empresaNome || 'sua empresa'} (versão {aviso.versao}).</p>
      <section className="cartao" aria-label="Aviso de privacidade">
        <div className="texto-termo" tabIndex={0}>{aviso.texto}</div>
        <div className="acoes">
          <button type="button" onClick={darCiencia} disabled={enviando}>{enviando ? 'Registrando…' : 'Li e estou ciente'}</button>
        </div>
        {erro && <p role="alert" className="erro">Não foi possível registrar. Tente novamente.</p>}
        <p style={{ marginTop: 14 }}><small>Você pode rever este aviso, baixar seus dados ou fazer pedidos sobre eles a qualquer momento em Meu perfil.</small></p>
      </section>
    </main>
  )
}
