const MENSAGENS: Record<string, string> = {
  conflito_agenda: 'Esse veículo já está reservado (ou em intervalo técnico) nesse horário.',
  antecedencia_minima_nao_respeitada: 'A reserva precisa ser feita com mais antecedência.',
  antecedencia_maxima_excedida: 'A data está além do limite de antecedência permitido.',
  duracao_maxima_excedida: 'A reserva ultrapassa a duração máxima permitida.',
  periodo_invalido: 'O fim precisa ser depois do início.',
  cnh_nao_cadastrada: 'Sua CNH não está cadastrada. Procure o gestor da frota.',
  cnh_vencida: 'Sua CNH vence antes do fim da reserva.',
  cnh_categoria_incompativel: 'Sua categoria de CNH não permite dirigir esse veículo.',
  politica_nao_aceita: 'Você precisa aceitar a política de uso da frota antes de reservar.',
  limite_semanal_excedido: 'Você atingiu o limite semanal de horas de uso.',
  veiculo_indisponivel: 'Esse veículo não está disponível para reserva.',
  veiculo_nao_encontrado: 'Veículo não encontrado.',
  sem_veiculo_disponivel: 'Não há veículo livre nesse horário.',
  justificativa_obrigatoria: 'Para recusar, escreva a justificativa.',
  ultimo_admin: 'A empresa precisa de pelo menos um administrador ativo.',
  motorista_fora_da_empresa: 'Essa pessoa não pertence à empresa.',
  fotos_obrigatorias_faltando: 'Faltam fotos obrigatórias. Tire todas as fotos pedidas.',
  odometro_invalido: 'O odômetro informado é menor que o último registrado para esse veículo.',
  combustivel_invalido: 'Informe o nível de combustível.',
  checklist_obrigatorio: 'Responda todos os itens do checklist.',
  vistoria_fora_de_hora: 'Essa vistoria não pode ser feita agora. Confira a situação da reserva.',
  sem_permissao: 'Você não tem permissão para essa ação.',
  nao_autenticado: 'Sua sessão expirou. Entre novamente.',
}

export function mensagemDeErro(erro: { message?: string } | null | undefined): string {
  const bruto = erro?.message ?? ''
  const codigo = Object.keys(MENSAGENS).find((c) => bruto.includes(c))
  if (codigo) return MENSAGENS[codigo]
  if (bruto.startsWith('transicao_nao_permitida')) return 'Essa ação não é permitida para a reserva nesse estado.'
  return 'Não foi possível concluir. Tente novamente.'
}
