// O sistema opera no horário de Brasília (UTC-3, sem horário de verão desde 2019),
// independentemente do fuso do aparelho de quem usa.
const FUSO = '-03:00'
const DESLOCAMENTO_MS = 3 * 60 * 60 * 1000

/** 'AAAA-MM-DDTHH:mm' digitado no campo (hora de Brasília) -> instante ISO em UTC. */
export function paraInstante(campo: string): string {
  const base = campo.length === 16 ? `${campo}:00` : campo
  return new Date(`${base}${FUSO}`).toISOString()
}

/** Instante ISO -> valor de campo datetime-local na hora de Brasília. */
export function paraCampo(iso: string | Date): string {
  return new Date(new Date(iso).getTime() - DESLOCAMENTO_MS).toISOString().slice(0, 16)
}

export function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

/** Próxima hora cheia a partir de agora + `horas`, como valor de campo. */
export function sugestaoDeInicio(agora = new Date(), horas = 2): string {
  const t = new Date(agora.getTime() + horas * 3600e3)
  t.setUTCMinutes(0, 0, 0)
  return paraCampo(new Date(t.getTime() + 3600e3))
}
