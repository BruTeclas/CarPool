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
          aria-label={visivel ? `Ocultar ${rotulo.toLowerCase()}` : `Mostrar ${rotulo.toLowerCase()}`} onClick={() => setVisivel((v) => !v)}>
          {visivel ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </div>
  )
}
