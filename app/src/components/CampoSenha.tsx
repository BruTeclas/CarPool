import { useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { rotulo: string }

/** Campo de senha com botão para mostrar ou ocultar o que foi digitado */
export function CampoSenha({ rotulo, ...props }: Props) {
  const id = useId()
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="campo-senha-bloco">
      <label htmlFor={id}>{rotulo}</label>
      <div className="campo-senha">
        <input id={id} {...props} type={visivel ? 'text' : 'password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button type="button" className="ver-senha" aria-pressed={visivel} aria-controls={id}
          title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          aria-label={visivel ? `Ocultar ${rotulo.toLowerCase()}` : `Mostrar ${rotulo.toLowerCase()}`} onClick={() => setVisivel((v) => !v)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {visivel && <line x1="3" y1="3" x2="21" y2="21" />}
          </svg>
        </button>
      </div>
    </div>
  )
}
