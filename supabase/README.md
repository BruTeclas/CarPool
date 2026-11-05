# Banco de dados (Supabase)

Projeto: `carpool-corporativo` (`sa-east-1`).

- `migrations/`: schema versionado, aplicado em ordem. Mudança no banco só por migration.
- `seed.sql`: dados de **desenvolvimento** (duas empresas, 5 usuários). Troque `__SENHA__` por uma senha aleatória ao aplicar; nunca commitar a senha.
- `tests/isolamento.sql`: prova que uma empresa não lê nem altera dados de outra e que a auditoria é append-only. Deve terminar sem erro.

Ordem para recriar do zero: migrations → seed → tests.
