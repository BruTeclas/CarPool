import { rotuloStatus } from '../lib/status'

export function Situacao({ status }: { status: string }) {
  return <span className={`situacao s-${status}`}>{rotuloStatus(status)}</span>
}
