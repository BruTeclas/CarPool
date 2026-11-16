import { describe, expect, it } from 'vitest'
import { gerarCsv } from './csv'

describe('gerarCsv', () => {
  it('usa ponto e vírgula, vírgula decimal, Sim/Não e BOM', () => {
    const csv = gerarCsv([{ a: 'Carro', b: 4.5, c: true }], [
      { titulo: 'Nome', valor: (l) => l.a }, { titulo: 'Horas', valor: (l) => l.b }, { titulo: 'Atrasou', valor: (l) => l.c },
    ])
    expect(csv).toBe('﻿Nome;Horas;Atrasou\r\nCarro;4,5;Sim\r\n')
  })
  it('protege texto com ponto e vírgula, aspas e quebra de linha', () => {
    const csv = gerarCsv([{ a: 'Visita; cliente "X"\nzona sul' }], [{ titulo: 'Finalidade', valor: (l) => l.a }])
    expect(csv).toContain('"Visita; cliente ""X""\nzona sul"')
  })
  it('deixa vazio o que não tem valor', () => {
    expect(gerarCsv([{ a: null }], [{ titulo: 'X', valor: (l) => l.a }])).toBe('﻿X\r\n\r\n')
  })
})
