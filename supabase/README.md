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

## Primeiro usuário em produção
O banco não tem usuários de teste. Para liberar o primeiro acesso:
1. Crie o usuário em Authentication → Users (marque "Auto Confirm User").
2. No SQL Editor, crie a empresa e o vínculo de administrador:
```sql
with e as (insert into public.empresas (nome) values ('Nome da empresa') returning id)
insert into public.membros (empresa_id, user_id, perfil, nome)
select e.id, (select id from auth.users where email = 'seu@email.com'), 'admin', 'Seu nome' from e;
```

## Função `criar-membro`
Em `functions/criar-membro`. Chamada pela tela Pessoas: só um administrador ativo da empresa consegue usar. Cria a conta com senha provisória (mostrada uma única vez) ou, se o e-mail já tiver conta, apenas vincula à empresa. Publicar de novo após alterar o arquivo.
