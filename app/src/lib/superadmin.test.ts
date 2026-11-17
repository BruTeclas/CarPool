import { describe, expect, it } from 'vitest'
import { cnpjValido, formatarCnpj } from './superadmin'

describe('CNPJ', () => {
  it('confere os dígitos verificadores', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11222333000182')).toBe(false)
    expect(cnpjValido('00000000000000')).toBe(false)
    expect(cnpjValido('123')).toBe(false)
  })
  it('formata com pontos, barra e traço', () => {
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81')
  })
})
