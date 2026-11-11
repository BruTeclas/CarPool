/** Traduz erros do Postgres/PostgREST dos cadastros para uma frase que o usuário entende. */
export function mensagemDeCadastro(erro: { code?: string; message?: string } | null | undefined): string {
  if (erro?.message?.includes('ultimo_admin')) return 'A empresa precisa de pelo menos um administrador ativo.'
  switch (erro?.code) {
    case '23505': return 'Já existe um registro igual a esse.'
    case '23503': return 'Esse registro está em uso em outro cadastro e não pode ser excluído.'
    case '23514': return 'Algum campo tem valor inválido. Confira o formato.'
    case '23502': return 'Preencha todos os campos obrigatórios.'
    case '42501': return 'Você não tem permissão para fazer essa alteração.'
    default: return 'Não foi possível salvar. Tente novamente.'
  }
}
