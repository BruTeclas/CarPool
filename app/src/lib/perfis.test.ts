import { describe, expect, it } from 'vitest'
import { rotuloPerfil } from './perfis'

describe('rotuloPerfil', () => {
  it('traduz o perfil para português', () => {
    expect(rotuloPerfil('gestor_frota')).toBe('Gestor de frota')
    expect(rotuloPerfil('admin')).toBe('Administrador')
  })
})
