# Plano de desenvolvimento do CarPool

Complementa `plano-mvp.md` (visão por etapas) com o estado real do projeto, decisões técnicas já tomadas e o trabalho dividido em sprints verificáveis. Fonte funcional: `estudo-funcional.md`.

## 1. Onde estamos

| Item | Situação |
|---|---|
| Repositório `BruTeclas/CarPool` | Criado, branch `main` |
| Estudo funcional e plano do MVP | Em `docs/` |
| Skills do projeto e de apoio | Em `.claude/skills/` (Supabase, Postgres, React, design, testes, `carpool-reserva`, `carpool-dominio`) |
| Projeto Supabase `carpool-corporativo` | Criado em `sa-east-1` (ref `lsqssnerbocisxmhxfag`), **banco vazio** |
| App `app/` (React + TS + Vite + PWA) | Compila e passa no lint; tela única de placeholder; cliente Supabase pronto |
| Testes | `vitest` instalado, **nenhum teste escrito** |
| CI | **Não configurado** (sobrou da Etapa 0) |
| Hospedagem e domínio | Indefinidos; por enquanto só desenvolvimento local |

## 2. Decisões técnicas (valem para todos os sprints)

**Multiempresa.** Toda tabela de negócio tem `empresa_id`. A tabela `membros` liga usuário, empresa e perfil. RLS compara `empresa_id` com as empresas do usuário logado, via função auxiliar em schema privado (não exposto pela API). Um usuário pode ter vários perfis e vários escopos (base).

**Estado da reserva só muda no servidor.** O papel `authenticated` não tem `UPDATE` direto na tabela de reservas. Toda mudança passa por função `SECURITY DEFINER` (`transicionar_reserva`), que valida a regra, grava o `evento_da_reserva` e devolve o novo estado.

**Eventos imutáveis.** `evento_da_reserva` e `registro_de_auditoria` aceitam só `INSERT`: sem policy de update/delete e com trigger que bloqueia essas operações até para o dono da tabela.

**Reserva duplicada: correção ao estudo.** O SQL do estudo usa `fim + intervalo_tecnico` dentro do `EXCLUDE`. Com `timestamptz` essa soma é `STABLE`, não `IMMUTABLE`, e o Postgres recusa a expressão no índice. Solução: coluna `bloqueio_fim timestamptz`, preenchida por trigger de `BEFORE INSERT/UPDATE` com `fim + intervalo_tecnico` (lido da política), e a restrição usa `tstzrange(inicio, bloqueio_fim)`. O Sprint 2 prova isso com teste de concorrência.

**Políticas em tabela.** As 18 regras do estudo ficam em `politicas` (por empresa, base ou grupo, com versão). Nenhum valor de regra fica fixo no código.

**Fotos.** Bucket privado no Storage, caminho `empresa_id/reserva_id/...`, com hash SHA-256, data, hora e coordenadas gravados na tabela `fotos`. Acesso por URL assinada de curta duração.

**Fuso horário.** Tudo em `timestamptz` (UTC no banco); exibição em `America/Sao_Paulo`.

**Chaves de API.** Só a chave publicável vai ao navegador. Nada de `service_role` no app. Segredos de funções ficam nos secrets do Supabase.

**Migrations.** Arquivos em `supabase/migrations/`, versionados no Git, aplicados no projeto Supabase e repetíveis do zero. Mudança no banco sempre por migration, nunca editando pelo painel.

## 3. Sprints

Cada sprint termina com uma demonstração e com testes automatizados passando. Skills a carregar antes de cada tipo de trabalho estão indicadas.

### Sprint 1 · Fundação de dados e login
*Skills: `supabase`, `supabase-postgres-best-practices`, `carpool-dominio`.*

- [x] CI no GitHub Actions: lint, tipos, build e testes do app.
- [x] Estrutura `supabase/` (config, migrations, tests) e script para aplicar do zero.
- [x] Migration 001: `empresas`, `unidades`, `bases`, `vagas`, `membros` (perfil: motorista, solicitante, aprovador, gestor_base, gestor_frota, financeiro, admin), função auxiliar de empresa e RLS em tudo.
- [x] Migration 002: `registro_de_auditoria` (append-only) e triggers de auditoria nas tabelas de cadastro.
- [x] Login por e-mail e senha no app, rota protegida, tela "meu perfil" lendo `membros`.
- [x] Seed de desenvolvimento com **duas empresas** e um usuário de cada perfil.
- [x] Testes de banco: usuário da empresa A não lê, não altera e não insere na empresa B em **cada** tabela; auditoria não aceita update/delete.

**Pronto quando:** login funciona, o app lê só os dados da empresa do usuário, e os testes de isolamento passam no CI.

### Sprint 2 · Cadastros, políticas e núcleo da reserva
*Skills: `supabase-postgres-best-practices`, `carpool-reserva`, `carpool-dominio`.*

- [ ] Migration 003: `categorias`, `veiculos`, `usuarios_condutores` com `cnhs` (número, categoria, validade, revalidação), `grupos`, `politicas` versionadas, `aceites_de_politica`.
- [ ] Migration 004: `reservas` (inclui `bloqueio_fim`), `eventos_da_reserva`, `aprovacoes`, restrição `EXCLUDE` corrigida, índices nas chaves estrangeiras e nas buscas de agenda.
- [ ] Função `transicionar_reserva` com as transições do estudo e as validações de CNH, antecedência, duração, intervalo técnico e limite semanal.
- [ ] Função de disponibilidade (veículos livres em um período, por categoria, escolhendo a placa pelo critério de desgaste).
- [ ] Portal do gestor: CRUD de veículos, bases, vagas, usuários, CNH e grupos.
- [ ] Testes: duas transações reservando o mesmo carro ao mesmo tempo (uma falha); intervalo técnico respeitado; CNH vencida bloqueia; evento sempre gravado; update direto em `reservas` negado.

**Pronto quando:** o gestor cadastra uma frota completa e o banco recusa qualquer reserva conflitante, mesmo em concorrência.

### Sprint 3 · Fluxo do motorista: reservar e aprovar
*Skills: `vercel-react-best-practices`, `web-design-guidelines`, `carpool-reserva`.*

- [ ] Telas do motorista: nova reserva em até 3 toques, minhas reservas, detalhe com linha do tempo de eventos.
- [ ] Reserva por categoria e por placa; mensagem clara em caso de conflito, com horários alternativos.
- [ ] Aprovação por alçada (pernoite, fim de semana, distância): fila do aprovador, decisão com justificativa.
- [ ] Aceite da política vigente antes da primeira reserva.
- [ ] Cancelamento com regra de antecedência.
- [ ] Testes de interface com Playwright no fluxo reservar → aprovar → cancelar.

**Pronto quando:** motorista e aprovador completam o fluxo no celular e a trilha de eventos aparece correta.

### Sprint 4 · Chave, retirada, vistoria e devolução
*Skills: `carpool-reserva`, `webapp-testing`, `web-design-guidelines`.*

- [ ] Migration 005: `chaves` (identificador opaco), `vistorias`, `itens_de_vistoria`, `fotos`, `avarias`, `ocorrencias`, `ordens_de_servico`, bucket de fotos com policies.
- [ ] Geração e impressão de etiquetas QR (identificador opaco, sem placa nem dados do carro).
- [ ] Leitura do QR no app com os seis comportamentos do estudo (chave certa, errada, sem reserva, fora da janela, sem login, sem internet).
- [ ] Painel da portaria: entrega manual de chave com código da reserva.
- [ ] Vistoria de saída e de chegada: checklist por tipo de veículo, fotos guiadas (frente, traseira, duas laterais, painel), km e combustível, hash das fotos.
- [ ] Comparação entre vistorias abre avaria; item crítico reprovado bloqueia o veículo e abre ordem de serviço.
- [ ] Modo offline: reserva baixada no aparelho, fila local de leituras e fotos, sincronização com carimbo de tempo.
- [ ] Teste em aparelhos reais (Android e iPhone) para câmera, QR e offline.

**Pronto quando:** o ciclo reserva → retirada → uso → devolução → encerramento roda de ponta a ponta no celular.

### Sprint 5 · Exceções e rotinas automáticas
*Skills: `carpool-reserva`, `supabase`.*

- [ ] Jobs agendados (`pg_cron` e Edge Functions): no-show (30 min), alerta de atraso (15 min), expiração de credenciais, suspensão após 3 ocorrências em 30 dias.
- [ ] Realocação: se o atraso afeta a próxima reserva, oferecer outro veículo ao próximo usuário.
- [ ] Botão de ocorrência (pane ou acidente) com localização e encerramento especial.
- [ ] Notificações por e-mail e push; preferências do usuário.
- [ ] Um teste automatizado por exceção listada no estudo.

**Pronto quando:** cada exceção do estudo tem comportamento definido, testado e visível na linha do tempo.

### Sprint 6 · Central da portaria e relatórios
*Skills: `vercel-react-best-practices`, `web-design-guidelines`, `supabase`.*

- [ ] Central da portaria (tablet/TV, modo quiosque) com agenda do dia e atualização em tempo real (Realtime).
- [ ] Relatórios: ocupação, utilização, reservas não utilizadas, demanda não atendida, pico simultâneo, índice de atraso, disponibilidade operacional.
- [ ] Exportação CSV por centro de custo para o financeiro (perfil somente leitura).
- [ ] Revisão de desempenho das consultas com `EXPLAIN` nos relatórios.

**Pronto quando:** o gestor responde "a frota está grande ou pequena?" com dado do próprio sistema.

### Sprint 7 · LGPD, segurança e publicação
*Skills: `supabase`, `supabase-postgres-best-practices`, `web-design-guidelines`, `webapp-testing`.*

- [ ] Aviso de privacidade configurável e registro de ciência.
- [ ] Retenção configurável por tipo de dado, com rotina de anonimização e eliminação.
- [ ] Exportação, correção e eliminação dos dados do titular.
- [ ] Revisão de segurança (advisors do Supabase, policies, buckets, chaves) e revisão de acessibilidade.
- [ ] Testes ponta a ponta do ciclo completo.
- [ ] Escolha de hospedagem e domínio, publicação e backups.
- [ ] Roteiro de implantação para o primeiro cliente (cadastro, etiquetas, treinamento).

**Pronto quando:** o sistema está publicado, com checklist de segurança e LGPD fechado, pronto para um piloto.

## 4. Riscos e como o plano os cobre

| Risco | Onde é tratado |
|---|---|
| Reserva duplicada | Sprint 2: restrição no banco corrigida e teste de concorrência |
| Vazamento entre empresas | Sprint 1: testes de isolamento em toda tabela, reexecutados a cada sprint |
| Câmera, QR e offline variam por aparelho | Sprint 4: teste em aparelhos reais |
| Regras fixas no código | Sprint 2: `politicas` em tabela |
| Base legal dos dados de empregados | Sprint 7 e parecer jurídico antes do piloto |
| Hospedagem e domínio indefinidos | Decididos só no Sprint 7; até lá, desenvolvimento local |

## 5. Regras de trabalho

1. Mudança no banco só por migration versionada, com teste.
2. Tabela nova nasce com `empresa_id`, RLS e teste de isolamento.
3. Nenhuma regra de negócio só no cliente.
4. Sprint só fecha com CI verde e demonstração.
5. Fora do MVP, e portanto fora destes sprints: armário, cofre, acesso sem chave, telemetria, multas, abastecimento, rateio, WhatsApp, SSO, API pública, IA em fotos e carona.
