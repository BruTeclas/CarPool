import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { urlDaImagem } from '../lib/comunicados'
import type { Comunicado } from '../lib/comunicados'

/** Corpo do comunicado (imagem, texto e botão de ação), usado no pop-up, em Avisos e na prévia do gestor */
export function CorpoDoComunicado({ c, imagemLocal }: { c: Pick<Comunicado, 'titulo' | 'texto' | 'imagem_caminho' | 'acao_rotulo' | 'acao_link'>; imagemLocal?: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!imagemLocal && c.imagem_caminho) void urlDaImagem(c.imagem_caminho).then(setUrl)
  }, [c.imagem_caminho, imagemLocal])
  const imagem = imagemLocal ?? url
  const interno = c.acao_link?.startsWith('/')
  return (
    <>
      {imagem && <img className="comunicado-imagem" src={imagem} alt="" />}
      {c.texto && <p className="comunicado-texto">{c.texto}</p>}
      {c.acao_link && c.acao_rotulo && (
        interno
          ? <p><Link className="botao secundario-link" to={c.acao_link}>{c.acao_rotulo}</Link></p>
          : <p><a className="botao secundario-link" href={c.acao_link} target="_blank" rel="noopener noreferrer">{c.acao_rotulo}</a></p>
      )}
    </>
  )
}
