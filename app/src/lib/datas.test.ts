import { describe, expect, it } from 'vitest'
import { paraCampo, paraInstante, sugestaoDeInicio } from './datas'

describe('datas em horário de Brasília', () => {
  it('converte o campo para UTC somando 3 horas', () => {
    expect(paraInstante('2026-12-08T14:00')).toBe('2026-12-08T17:00:00.000Z')
  })
  it('vira o dia corretamente', () => {
    expect(paraInstante('2026-12-08T22:30')).toBe('2026-12-09T01:30:00.000Z')
  })
  it('ida e volta preserva o valor', () => {
    expect(paraCampo(paraInstante('2026-12-08T09:15'))).toBe('2026-12-08T09:15')
  })
  it('sugere a próxima hora cheia depois da antecedência', () => {
    expect(sugestaoDeInicio(new Date('2026-12-08T13:20:00Z'), 2)).toBe('2026-12-08T13:00')
  })
})
