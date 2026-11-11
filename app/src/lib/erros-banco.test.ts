import { describe, expect, it } from 'vitest'
import { mensagemDeCadastro } from './erros-banco'

describe('mensagemDeCadastro', () => {
  it('traduz duplicidade, uso e permissão', () => {
    expect(mensagemDeCadastro({ code: '23505' })).toContain('Já existe')
    expect(mensagemDeCadastro({ code: '23503' })).toContain('em uso')
    expect(mensagemDeCadastro({ code: '42501' })).toContain('permissão')
  })
  it('tem mensagem genérica', () => {
    expect(mensagemDeCadastro(null)).toContain('Não foi possível')
  })
})
