# Teste de carga (k6)

`carga.js` mede o site publicado e a API do Supabase com usuários de verdade (login, RLS e regras do banco).

| Cenário | O que faz |
|---|---|
| `site` | 5 visitas/s ao site publicado (página inicial, entrada e o JavaScript principal) |
| `leitura` | até 30 motoristas usando o app ao mesmo tempo: vínculos, pendências, disponibilidade, minhas reservas, avisos, comunicados, treinamentos, privacidade |
| `reserva` | até 10 pessoas criando e cancelando reservas sem parar |
| `corrida` | 30 motoristas tentando o mesmo carro no mesmo horário, no mesmo instante: só 1 pode conseguir |
| `estresse` | (só quando pedido) a leitura com até 100 motoristas |

## Como rodar

1. Criar a empresa de teste `Carga k6 (teste)` (id `cccccccc-0000-4000-8000-000000000001`) com 10 veículos, uma política folgada aceita por todos,
   os usuários `k6.m01@carpool.test` … `k6.m30@carpool.test` (motoristas com CNH B) e `k6.admin@carpool.test`, todos com a mesma senha temporária.
2. `K6_SENHA=<senha> k6 run testes/carga/carga.js` (todos os cenários menos o estresse, ~4 min)
3. `CENARIOS=estresse K6_SENHA=<senha> k6 run testes/carga/carga.js` (só o estresse, ~4 min); `CENARIOS=corrida` roda só a corrida.
4. Apagar a empresa e os usuários de teste ao final.

## Resultado em 17/11/2026 (Supabase gratuito, sa-east-1; teste rodando de fora do Brasil)

- Carga normal: 16.532 requisições em 4 min, 0 falhas; p95 geral 247 ms; 825 reservas criadas e canceladas.
- Corrida: 1 reserva criada, 29 recusadas com `conflito_agenda`; no banco, uma única reserva no horário.
- Estresse: 100 usuários simultâneos (~230 req/s), 38.226 requisições, 0 falhas, p95 ~220 ms estável.
- No servidor: nenhum erro do Postgres além dos 29 conflitos esperados; consultas com média de 0,3 a 3 ms
  (o tempo medido é quase todo rede).
