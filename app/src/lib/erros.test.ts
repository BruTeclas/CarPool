import { describe, expect, it } from 'vitest'
import { mensagemDeErro } from './erros'

describe('mensagemDeErro', () => {
  it('traduz códigos conhecidos', () => {
    expect(mensagemDeErro({ message: 'conflito_agenda' })).toContain('já está reservado')
    expect(mensagemDeErro({ message: 'cnh_vencida' })).toContain('CNH')
  })
  it('traduz transição inválida', () => {
    expect(mensagemDeErro({ message: 'transicao_nao_permitida: aprovada -> em_uso' })).toContain('não é permitida')
  })
  it('usa mensagem genérica para erro desconhecido', () => {
    expect(mensagemDeErro(null)).toBe('Não foi possível concluir. Tente novamente.')
  })
})
