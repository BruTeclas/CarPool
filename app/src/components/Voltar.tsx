import { Link } from 'react-router-dom'

/** Link discreto para voltar à página anterior da hierarquia */
export function Voltar({ para, children }: { para: string; children: string }) {
  return (
    <Link to={para} className="voltar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {children}
    </Link>
  )
}
