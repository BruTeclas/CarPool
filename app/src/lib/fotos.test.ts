import { describe, expect, it } from 'vitest'
import { POSICOES_CHEGADA, POSICOES_SAIDA, sha256Hex } from './fotos'

describe('fotos da vistoria', () => {
  it('calcula o SHA-256 em hexadecimal', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('exige cinco fotos na saída e a vaga a mais na chegada', () => {
    expect(POSICOES_SAIDA.map((p) => p.id)).toEqual(['frente', 'traseira', 'lateral_esquerda', 'lateral_direita', 'painel'])
    expect(POSICOES_CHEGADA.at(-1)?.id).toBe('vaga')
  })
})
