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

- [x] Tipos de documento definidos pelo administrador (do condutor e do veículo), com marcação de obrigatório e de validade.
- [x] Condutor envia a CNH e outros documentos com foto ou PDF e a data de validade.
- [x] Gestor confere e aprova ou recusa com motivo; só documento aprovado e válido libera a reserva.
- [x] Documentos do veículo (CRLV, seguro, licenciamento) com o mesmo controle de validade.
- [x] Painel "vencendo em breve" para o gestor e aviso para o condutor, com prazo de antecedência configurável pela empresa (padrão 30 dias). Os lembretes escalonados (30, 15 e 7 dias) por e-mail ficam para o item "Envio de e-mail e push", depois do Sprint 7.
- [x] Termo de uso redigido pelo administrador, com versões.
- [x] Assinatura desenhada na tela antes da primeira reserva e a cada nova versão, com nome, data, hora e código de integridade do texto.
- [x] Termo assinado em PDF, guardado sem alteração e disponível para o condutor e para o gestor.

**Pronto quando:** um condutor novo só consegue reservar depois de ter documentos aprovados e o termo assinado, e os dois lados conseguem baixar o termo.

**Situação (16/11/2026):** concluído. Banco testado em `supabase/tests/documentos.sql`; fluxo completo testado no navegador (assinatura, bloqueio até a CNH aprovada, aprovação, vencimento, documento do veículo, PDF, nova versão do termo exigindo nova assinatura). A recusa de documento foi testada só no banco, não no navegador.

### Sprint 5 · Exceções e rotinas automáticas
*Skills: `carpool-reserva`, `supabase`.*

- [x] Rotinas agendadas no banco (`pg_cron`, a cada minuto): no-show após a tolerância (30 min), atraso após fim + 15 min com aviso ao motorista e à gestão, solicitação que chega ao horário sem aprovação expira, chave lida sem retirada também vira no-show, suspensão automática após 3 faltas em 30 dias (prazos configuráveis na política). Rotina diária de vencimento de documentos (prazo da empresa, 15, 7, 1 e 0 dias).
- [x] Realocação: atraso ou ocorrência que afeta a próxima reserva oferece outro veículo (mesma categoria e base primeiro, filial liberada, CNH e documentos em dia); o motorista aceita ou mantém; sem alternativa, a gestão é avisada.
- [x] Botão "Pane ou acidente" na reserva em uso: tipo, atalhos para 192/193/190 quando há vítima, localização do celular, telefone da assistência (padrão da empresa ou do carro), fotos, funciona sem sinal. Carro bloqueado na hora; gestor encerra informando onde o carro ficou (encerramento especial).
- [x] Avisos dentro do sistema (menu Avisos, com contador) para motorista e gestão. Push no aparelho e preferências do usuário foram para o item "Envio de e-mail e push", depois do Sprint 7, porque precisam do app publicado em HTTPS para testar.
- [x] Teste automatizado do banco: `supabase/tests/excecoes.sql` (10 situações); fluxo testado no navegador, inclusive em tela de celular.

**Pronto quando:** cada exceção do estudo tem comportamento definido, testado e visível na linha do tempo.

**Situação (16/11/2026):** concluído, menos push e preferências (adiados com o e-mail). Não testado em celular real nem a fila offline da ocorrência (o modo offline só roda na versão publicada).

### Sprint 6 · Central da portaria e relatórios
*Skills: `vercel-react-best-practices`, `web-design-guidelines`, `supabase`.*

- [x] Central da portaria em `/central` (tablet ou TV, tela cheia): saídas, carros na rua, voltam hoje e alertas (atraso, pane ou acidente, conferência pendente), atualizada em tempo real pelo Supabase Realtime, com recarga a cada minuto se o tempo real cair.
- [x] Relatórios em `/relatorios`: utilização, ocupação, pico simultâneo, disponibilidade, demanda não atendida (registrada quando a busca não acha carro), não retiradas e cancelamentos fora do prazo, atrasos e km, por período e filial, com uma frase de diagnóstico ("a frota está grande ou pequena?").
- [x] Resumo por centro de custo e CSV para o Excel (uma linha por reserva, e outro por veículo). O perfil financeiro vê só relatórios. A reserva ganhou o campo "Centro de custo".
- [ ] Revisão de desempenho com `EXPLAIN`: índices dos relatórios criados, mas a medição com volume real fica para o piloto (com os poucos dados de teste o `EXPLAIN` não diz nada).

**Pronto quando:** o gestor responde "a frota está grande ou pequena?" com dado do próprio sistema.

**Situação (16/11/2026):** concluído, menos a medição de desempenho com volume real. Banco testado em `supabase/tests/relatorios.sql` (números conferidos à mão); telas testadas no navegador, inclusive a central mudando sozinha em cerca de 2 segundos quando uma reserva é cancelada.

### Sprint 7 · LGPD, segurança e publicação
*Skills: `supabase`, `supabase-postgres-best-practices`, `web-design-guidelines`, `webapp-testing`.*

- [x] Aviso de privacidade configurável e registro de ciência: o administrador publica versões em `/privacidade` (com texto-modelo); cada pessoa lê e dá ciência no primeiro acesso depois de cada versão.
- [x] Retenção configurável por tipo de dado (localização, fotos, documentos, desligados, avisos, auditoria), com rotina diária de anonimização e eliminação, inclusive dos arquivos no Storage.
- [x] Exportação, correção e eliminação dos dados do titular: em Meu perfil a pessoa baixa seus dados (JSON), corrige o nome e faz pedidos; o administrador responde e pode remover os dados de uma pessoa.
- [x] Revisão de segurança (advisors do Supabase, policies, buckets, chaves) e revisão de acessibilidade (axe, WCAG A/AA, tema claro e escuro: contrastes corrigidos). Resultado em `supabase/README.md`. Falta ligar no painel a proteção contra senhas vazadas.
- [ ] Testes ponta a ponta do ciclo completo.
- [ ] Escolha de hospedagem e domínio, publicação e backups.
- [ ] Roteiro de implantação para o primeiro cliente (cadastro, etiquetas, treinamento).

**Pronto quando:** o sistema está publicado, com checklist de segurança e LGPD fechado, pronto para um piloto.

### Sprint 8 · Treinamentos e comunicados
*Combinado em 16/11/2026. Só a estrutura: o conteúdo (vídeos, textos, provas, comunicados) é cadastrado pelo gestor.*

**Parte 1 · Comunicados**
- [x] Gestor dispara comunicado com título, texto, imagem (reduzida para no máximo 1600 px) e botão de ação (link externo ou tela do app).
- [x] Público por perfil, grupo e filial, que se somam. Administrador e gestor de frota mandam para a empresa toda; gestor de base só para a própria filial.
- [x] Recorrência: uma vez, diária, semanal, mensal, anual (com dias no ar a cada ano, para campanhas como o Maio Amarelo) e "a cada acesso até confirmar".
- [x] Importância: informativo (registra quem viu), ciência obrigatória ("Li e entendi" com data e hora) e bloqueante (não reserva até dar ciência).
- [x] Pop-up em tela cheia ao abrir o app (no máximo 3 por acesso, bloqueantes primeiro), cópia em Avisos e aviso na tela de reservar.
- [x] Acompanhamento por comunicado (público, quem viu, quem confirmou), planilha CSV e encerramento. Comunicado enviado não muda.
- [ ] Push no celular com o app fechado: entra junto com o item "Envio de e-mail e push".

**Parte 2 · Treinamentos**
- [x] Modelos de treinamento com etapas em ordem: vídeo do YouTube (não listado), vídeo enviado (até 50 MB), texto e PDF (aberto dentro do app), cada uma com tempo mínimo. A duração do vídeo é lida sozinha.
- [x] Telemetria rígida: sem adiantar, velocidade 1x, pausa ao sair da tela, "Você está aí?" a cada 2 a 5 minutos (30 s para responder) e conferência do tempo no servidor; texto e PDF só concluem lidos até o fim.
- [x] Prova com múltipla escolha (uma ou várias certas), verdadeiro ou falso e resposta escrita (corrigida pelo gestor); nota mínima, tentativas limitadas (acabando, refaz o conteúdo) e embaralhamento.
- [x] Publicado não muda: nova versão copia tudo como rascunho e, ao ser publicada, tira a anterior do ar.
- [ ] Testar o vídeo do YouTube no site publicado (a rede do ambiente de testes bloqueia o YouTube; o vídeo enviado foi testado).

**Parte 3 · Bloqueios e resultados**
- [x] Público por perfil, grupo e filial (quem entra depois recebe sozinho); validade (reciclagem) com avisos 30, 7 e 1 dia antes; prazo em dias contado da publicação ou da entrada da pessoa (0 = bloqueia na hora). Aviso ao publicar e rotina diária de prazos.
- [x] Bloqueio escolhido pelo gestor: opcional, só novas reservas, ou novas reservas e retiradas (devolver sempre pode). A aprovação vale para todas as versões do treinamento; vencida, o conteúdo é refeito.
- [x] Certificado em PDF (pelo colaborador ou pelo gestor), painel de acompanhamento por situação e planilha CSV por treinamento e geral.

**Situação (17/11/2026):** concluído. Banco testado em `supabase/tests/comunicados.sql`, `treinamentos.sql` e `treinamentos_obrigatorios.sql`; telas testadas no navegador, no computador e no celular, com verificação de acessibilidade. Falta testar o vídeo do YouTube e o push no site publicado.

### Pendente para depois · Envio de e-mail e push
*Combinado em 16/11/2026: fazer só quando os outros pontos estiverem terminados.*

- [ ] Decidir o serviço de envio (recomendação: Resend, que tem plano grátis e integra bem com o Supabase).
- [ ] Configurar o domínio do remetente (por exemplo `zentrega.com.br`) com os registros DNS que o serviço pedir.
- [ ] Cadastrar a chave do serviço como segredo do Supabase (nunca no código nem no chat).
- [ ] E-mails de vencimento de documento escalonados a 30, 15 e 7 dias, para o condutor e para o gestor.
- [ ] E-mails das exceções do Sprint 5 (no-show, atraso, suspensão, ocorrência) e de aprovação de reserva, respeitando as preferências do usuário.
- [ ] Notificação push no aparelho (PWA) e preferências do usuário (o que receber e por qual canal); precisa do app publicado em HTTPS.
- [ ] Usar o mesmo serviço para os e-mails do login (convite e troca de senha) no lugar do envio padrão do Supabase, que tem limite baixo.

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
