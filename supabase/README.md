# Banco de dados (Supabase)

Projeto: `carpool-corporativo` (`sa-east-1`).

- `migrations/`: schema versionado, aplicado em ordem. Mudança no banco só por migration.
- `seed.sql`: dados de **desenvolvimento** (duas empresas, 5 usuários). Troque `__SENHA__` por uma senha aleatória ao aplicar; nunca commitar a senha.
- `tests/isolamento.sql`: prova que uma empresa não lê nem altera dados de outra e que a auditoria é append-only. Deve terminar sem erro.

Ordem para recriar do zero: migrations → seed → tests.

- `seed_frota.sql`: veículos, categorias e CNHs de desenvolvimento (rodar depois do `seed.sql`).
- `tests/reservas.sql`: 14 verificações das regras de reserva. Termina com a exceção `OK_TESTES_PASSARAM` (isso é sucesso e desfaz os dados de teste).

## Avisos esperados do advisor de segurança
`criar_reserva`, `disponibilidade` e `transicionar_reserva` são `SECURITY DEFINER` e chamáveis por `authenticated` de propósito: são a única porta de escrita das reservas e cada uma valida `auth.uid()` e a empresa do usuário. A proteção contra senhas vazadas do Auth é uma opção do painel.
