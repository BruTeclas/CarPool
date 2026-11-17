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
  it('diz qual treinamento obrigatório falta', () => {
    expect(mensagemDeErro({ message: 'treinamento_pendente: Direção segura' })).toBe('Falta o treinamento obrigatório “Direção segura”. Faça em Meus treinamentos para liberar.')
  })
  it('traduz os códigos dos treinamentos', () => {
    expect(mensagemDeErro({ message: 'pergunta_sem_gabarito' })).toContain('resposta certa')
    expect(mensagemDeErro({ message: 'etapa_bloqueada' })).toContain('etapa anterior')
  })
})
