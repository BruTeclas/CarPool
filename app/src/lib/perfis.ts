export type Perfil =
  | 'motorista' | 'solicitante' | 'aprovador' | 'gestor_base'
  | 'gestor_frota' | 'financeiro' | 'admin'

const ROTULOS: Record<Perfil, string> = {
  motorista: 'Motorista',
  solicitante: 'Solicitante',
  aprovador: 'Aprovador',
  gestor_base: 'Gestor de base',
  gestor_frota: 'Gestor de frota',
  financeiro: 'Financeiro',
  admin: 'Administrador',
}

export function rotuloPerfil(perfil: Perfil): string {
  return ROTULOS[perfil]
}
