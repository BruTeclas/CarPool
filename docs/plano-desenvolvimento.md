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

**Multiempresa e filiais.** Toda tabela de negócio tem `empresa_id`, e a RLS só mostra a empresa do usuário. Dentro da empresa, a estrutura é filial (`unidades`) → base → vaga/veículo. A tabela `membro_unidades` diz quais filiais cada pessoa pode usar: ela só vê e reserva veículos, bases, vagas, chaves e reservas dessas filiais. Administrador e gestor de frota veem todas. Em empresa com uma única filial, quem entra recebe essa filial automaticamente; com duas ou mais, o acesso é liberado pessoa a pessoa na tela Pessoas. As funções `SECURITY DEFINER` ignoram RLS, então a filial é conferida também nelas e num gatilho de `reservas` (migration 008).

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

- [x] Migration 003: `categorias`, `veiculos`, `usuarios_condutores` com `cnhs` (número, categoria, validade, revalidação), `grupos`, `politicas` versionadas, `aceites_de_politica`.
- [x] Migration 004: `reservas` (inclui `bloqueio_fim`), `eventos_da_reserva`, `aprovacoes`, restrição `EXCLUDE` corrigida, índices nas chaves estrangeiras e nas buscas de agenda.
- [x] Função `transicionar_reserva` com as transições do estudo e as validações de CNH, antecedência, duração, intervalo técnico e limite semanal.
- [x] Função de disponibilidade (veículos livres em um período, por categoria, escolhendo a placa pelo critério de desgaste).
- [x] Portal do gestor: veículos, categorias, unidades, bases, vagas, pessoas e perfis (com criação de acesso pela função `criar-membro`), CNH, grupos e políticas versionadas. Testado no navegador de ponta a ponta.
- [x] Testes: duas transações reservando o mesmo carro ao mesmo tempo (uma falha); intervalo técnico respeitado; CNH vencida bloqueia; evento sempre gravado; update direto em `reservas` negado.

**Pronto quando:** o gestor cadastra uma frota completa e o banco recusa qualquer reserva conflitante, mesmo em concorrência.

### Sprint 3 · Fluxo do motorista: reservar e aprovar
*Skills: `vercel-react-best-practices`, `web-design-guidelines`, `carpool-reserva`.*

- [x] Telas do motorista: nova reserva em até 3 toques, minhas reservas, detalhe com linha do tempo de eventos.
- [x] Reserva por categoria e por placa; mensagem clara em caso de conflito, com horários alternativos.
- [x] Aprovação por alçada (pernoite, fim de semana, distância): fila do aprovador, decisão com justificativa.
- [x] Aceite da política vigente antes da primeira reserva.
- [x] Cancelamento com regra de antecedência.
- [~] Fluxo reservar → aprovar → cancelar testado no navegador com script Playwright avulso (16 passos). O script ainda **não está no repositório nem no CI**, porque depende de usuários de teste no banco.

**Pronto quando:** motorista e aprovador completam o fluxo no celular e a trilha de eventos aparece correta.

### Sprint 4 · Chave, retirada, vistoria e devolução
*Skills: `carpool-reserva`, `webapp-testing`, `web-design-guidelines`.*

- [x] Migration 007: `chaves` (identificador opaco, criada junto com o veículo), `vistorias`, `itens_de_vistoria`, `fotos`, `avarias`, `ocorrencias`, `ordens_de_servico`, bucket privado `vistorias` com policies.
- [x] Etiquetas QR para impressão (o QR aponta para `/k/<código>`; sem placa no código).
- [x] Leitura do QR pela câmera do celular (abre o app): chave certa, chave errada, sem reserva, antes e fora da janela, sem login, CNH vencida e veículo bloqueado.
- [x] Portaria: entrega manual da chave pelo código de retirada e lista de movimento.
- [x] Vistoria de saída e de chegada: checklist, fotos obrigatórias reduzidas no aparelho, com SHA-256, data, hora e local, odômetro e combustível.
- [x] Comparação entre vistorias abre avaria; item crítico reprovado bloqueia o veículo e abre ordem de manutenção; conferência do gestor com fotos lado a lado.
- [x] Modo offline: as reservas ativas ficam guardadas no aparelho; leitura da chave, checklist e fotos funcionam sem sinal e vão para uma fila; o envio é automático quando o sinal volta, com o horário original do aparelho (aceito só se não estiver no futuro nem tiver mais de 48 h). Testado no navegador com a rede desligada.
- [x] Checklist configurável: lista geral da empresa ou por categoria de veículo; sem itens cadastrados vale a lista padrão. Regras testadas no banco; a tela de cadastro não foi testada no navegador.
- [ ] Teste em aparelhos reais (Android e iPhone) para câmera, QR e fotos. **Depende de publicar o sistema em HTTPS.**

**Pronto quando:** o ciclo reserva → retirada → uso → devolução → encerramento roda de ponta a ponta no celular. Rodou no navegador em tela de celular simulada (17 passos); falta o aparelho real.

### Sprint 4B · Documentos e termos (incluído a pedido, entra antes do Sprint 5)

Decisões confirmadas: documentos do veículo entram junto; documento enviado pelo condutor só vale depois de aprovado pelo gestor; a assinatura é eletrônica simples (desenhada na tela, com registro de evidências), não certificado ICP-Brasil.

- [ ] Tipos de documento definidos pelo administrador (do condutor e do veículo), com marcação de obrigatório e de validade.
- [ ] Condutor envia a CNH e outros documentos com foto ou PDF e a data de validade.
- [ ] Gestor confere e aprova ou recusa com motivo; só documento aprovado e válido libera a reserva.
- [ ] Documentos do veículo (CRLV, seguro, licenciamento) com o mesmo controle de validade.
- [ ] Avisos de vencimento a 30, 15 e 7 dias (prazos configuráveis) e painel "vencendo em breve". Por e-mail só depois das notificações do Sprint 5; até lá, dentro do sistema.
- [ ] Termo de uso redigido pelo administrador, com versões.
- [ ] Assinatura desenhada na tela antes da primeira reserva e a cada nova versão, com nome, data, hora e código de integridade do texto.
- [ ] Termo assinado em PDF, guardado sem alteração e disponível para o condutor e para o gestor.

**Pronto quando:** um condutor novo só consegue reservar depois de ter documentos aprovados e o termo assinado, e os dois lados conseguem baixar o termo.

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
