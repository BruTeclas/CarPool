# Banco de dados (Supabase)

Projeto: `carpool-corporativo` (`sa-east-1`).

- `migrations/`: schema versionado, aplicado em ordem. Mudança no banco só por migration.
- `seed.sql`: dados de **desenvolvimento** (duas empresas, 5 usuários). Troque `__SENHA__` por uma senha aleatória ao aplicar; nunca commitar a senha.
- `tests/isolamento.sql`: prova que uma empresa não lê nem altera dados de outra e que a auditoria é append-only. Deve terminar sem erro.

Ordem para recriar do zero: migrations → seed → tests.

- `seed_frota.sql`: veículos, categorias e CNHs de desenvolvimento (rodar depois do `seed.sql`).
- `tests/reservas.sql`: 14 verificações das regras de reserva. Termina com a exceção `OK_TESTES_PASSARAM` (isso é sucesso e desfaz os dados de teste).

## Revisão de segurança (Sprint 7, 16/11/2026)
Advisors do Supabase rodados depois de todas as migrations. O que sobrou é esperado:

- **Funções `SECURITY DEFINER` chamáveis por `authenticated`** (32): são a porta de escrita das regras de negócio (reserva, vistoria, documentos, ocorrência, LGPD). Cada uma confere `auth.uid()`, a empresa e o perfil antes de agir, e todas têm `search_path = ''`.
- **`ficha_veiculo` chamável por `anon`**: de propósito. É a ficha pública da etiqueta QR da chave (`/k/:codigo`) e devolve só placa, modelo e situação.
- **`arquivos_a_apagar` com RLS e sem policy**: de propósito. Só a função `limpar-arquivos` (service role) lê a fila.
- **`pg_net` no schema `public`**: a extensão não pode ser movida depois de instalada; não expõe dados.
- **Proteção contra senhas vazadas**: opção do painel (Authentication → Policies). Ligar antes do piloto.
- **Várias policies permissivas** (14 tabelas, `*_select` + `*_write`): mantidas. Separar o `*_write` em insert/update/delete muda a visibilidade em tabelas filtradas por filial; o ganho é desprezível no tamanho de frota do produto.
- **Índices sem uso**: o banco ainda não tem uso real; reavaliar no piloto.

Buckets `vistorias` e `documentos` são privados, com limite de tamanho (5 e 10 MB) e só imagens/PDF.

## LGPD (Sprint 7)
- Aviso de privacidade com versões (`avisos_privacidade`); o texto publicado não muda. Cada pessoa dá ciência no primeiro acesso depois de cada versão (`ciencias_privacidade`, só inclusão).
- Titular: `meus_dados` (exporta tudo em JSON), `atualizar_meu_nome`, `pedir_ao_controlador` (correção, exclusão ou outro; avisa os administradores). O administrador responde com `responder_solicitacao`.
- `anonimizar_pessoa`: troca o nome por "Pessoa removida", apaga CNH, documentos, avisos, grupos e localização, encerra a conta no Auth; o histórico de reservas fica. Bloqueia com reserva em andamento, a si mesmo e o último administrador.
- Prazos de guarda por empresa (`empresas.retencao_*`). A rotina `carpool-lgpd` (diária, 06:23 UTC) apaga localização, fotos, documentos substituídos, avisos lidos e auditoria vencidos e anonimiza quem está desligado há mais tempo que o prazo. Arquivos vão para `arquivos_a_apagar`, e a `carpool-limpeza-arquivos` (06:53 UTC) chama a função `limpar-arquivos`, que apaga do Storage.
- Teste: `tests/lgpd.sql`.

## Comunicados (Sprint 8, parte 1)
- `comunicados`: o gestor insere direto (RLS: admin e gestor de frota em toda a empresa; gestor de base só com `unidade_id` de uma filial dele). Depois de inserido só muda `encerrado_em`.
- `comunicado_leituras`: uma linha por pessoa e por repetição (`ocorrencia` = data em que a repetição começou). Só as funções escrevem.
- `app.comunicado_ocorrencia` calcula a repetição em vigor; `comunicados_pendentes` (pop-up), `meus_comunicados` (Avisos), `marcar_comunicado` (viu ou leu e entendeu) e `acompanhamento_comunicado` (gestor).
- Bloqueante sem ciência impede a reserva (gatilho `reservas_conferir_comunicados`, erro `comunicado_pendente`) e aparece em `pendencias_para_reservar`.
- Imagens no bucket privado `comunicados` (5 MB, só imagens), caminho `<empresa>/<arquivo>`.
- Teste: `tests/comunicados.sql`.

## Treinamentos (Sprint 8, parte 2)
- Gestão (admin e gestor de frota, direto nas tabelas): `treinamentos` (versões ligadas por `familia_id`), `treinamento_etapas`, `treinamento_perguntas`, `treinamento_alternativas`. Enquanto rascunho, tudo muda; `publicar_treinamento` confere etapas e gabarito e congela. `nova_versao_treinamento` copia tudo.
- O colaborador nunca lê o gabarito: usa `meus_treinamentos`, `conteudo_treinamento`, `iniciar_prova` (prova sorteada, sem a resposta certa) e `enviar_prova`.
- Telemetria: `sinal_etapa` a cada ~5 s credita no máximo o tempo real decorrido, só trecho novo do vídeo (barrando adiantar e velocidade acima de 1x) e guarda como "pendente"; `confirmar_presenca` ("Você está aí?") transforma o pendente em tempo válido, desde que a confirmação anterior tenha menos de 6 minutos. A etapa conclui no tempo mínimo (texto e PDF também precisam chegar ao fim).
- Prova: várias certas só pontua acertando todas; acabando as tentativas, `ciclo` sobe e o conteúdo é refeito. Resposta escrita fica "aguardando correção" até `corrigir_prova`.
- Arquivos no bucket privado `treinamentos` (50 MB, MP4, WebM e PDF), caminho `<empresa>/<treinamento>/<arquivo>`.
- Teste: `tests/treinamentos.sql`.

## Treinamentos obrigatórios (Sprint 8, parte 3)
- `bloqueio` em `treinamentos`: `nenhum` (opcional), `reservas` ou `reservas_e_retiradas`. Público, prazo e validade podem mudar depois de publicado.
- `app.treinamentos_obrigatorios(empresa, pessoa)`: situação em cada obrigatório (prazo, aprovação mais recente na família, em dia, bloqueando). Prazo = maior entre a publicação da primeira versão e a entrada da pessoa, + `prazo_dias`; com aprovação vencida, bloqueia na hora.
- Gatilho `reservas_conferir_treinamentos`: barra a reserva nova e, com `reservas_e_retiradas`, a passagem para `liberada` ou `em_uso` (erro `treinamento_pendente: <título>`). Aparece em `pendencias_para_reservar`.
- Reciclagem: `app.matricula` abre ciclo novo quando a aprovação venceu, e o conteúdo é refeito.
- `acompanhamento_treinamento` (gestor) e `certificado_treinamento` (a pessoa ou o gestor). Rotina `carpool-treinamentos` (diária, 11:17 UTC) avisa prazos (7, 1, 0 dias) e reciclagem (30, 7, 1 dia).
- Teste: `tests/treinamentos_obrigatorios.sql`.

## Super admin (Sprint 9)
- `super_admins`: quem administra o sistema. `app.eh_super_admin()`; as funções `super_*` conferem isso antes de tudo.
- `empresas` ganhou `cnpj` (conferido por `app.cnpj_valido`), `razao_social`, `situacao`/`motivo_suspensao`, `limite_*` e `modulos`. O admin do cliente não altera esses campos (gatilho `empresas_campos_do_super`).
- Módulos: `app.modulo_ativo`/`app.exigir_modulo`; desligado, relatórios recusam, ocorrência/treinamento/comunicado/documento/termo não são criados e as travas de reserva do módulo deixam de valer.
- Plano e suspensão: gatilho `app.conferir_empresa_e_plano` em membros, veículos, filiais, bases e reservas (`reservas_0_empresa_ativa` roda antes das outras travas).
- Suporte: `super_entrar_como` cria um vínculo de admin com `suporte_ate` (2 h) e `suporte_motivo`; `empresas_do_usuario`/`tem_perfil` ignoram vínculo vencido e a rotina `carpool-suporte` apaga os vencidos a cada 5 min.
- Convite: função `convidar-admin` (só super admin) convida por e-mail e vincula via `super_vincular_admin`.
- Teste: `tests/super_admin.sql`.

## Primeiro usuário em produção
O banco não tem usuários de teste. O primeiro acesso é o de super admin: crie o usuário em Authentication → Users e rode `insert into public.super_admins (user_id, nome) select id, 'Nome' from auth.users where email = '<email>';`. Daí em diante, empresas e admins são criados pelo painel `/super`. Caminho antigo, só para referência:
1. Crie o usuário em Authentication → Users (marque "Auto Confirm User").
2. No SQL Editor, crie a empresa e o vínculo de administrador:
```sql
with e as (insert into public.empresas (nome) values ('Nome da empresa') returning id)
insert into public.membros (empresa_id, user_id, perfil, nome)
select e.id, (select id from auth.users where email = 'seu@email.com'), 'admin', 'Seu nome' from e;
```

## Função `criar-membro`
Em `functions/criar-membro`. Chamada pela tela Pessoas: só um administrador ativo da empresa consegue usar. Cria a conta com senha provisória (mostrada uma única vez) ou, se o e-mail já tiver conta, apenas vincula à empresa. Publicar de novo após alterar o arquivo.

- `tests/sprint3.sql`: aceite de política, reserva por categoria, horários alternativos, recusa com justificativa, cancelamento tardio e último administrador. Autossuficiente (cria e desfaz os próprios dados); sucesso = `OK_TESTES_PASSARAM`.
- `tests/isolamento.sql` e `tests/reservas.sql` dependem dos usuários do `seed.sql`, que não existem no projeto remoto.
- `tests/sprint4.sql`: chave (certa, errada, desconhecida, janela), vistorias com fotos obrigatórias, avarias, bloqueio por item crítico e liberação pela manutenção. Autossuficiente; sucesso = `OK_TESTES_PASSARAM`.

## Fotos de vistoria
Bucket privado `vistorias`, caminho `<empresa>/<reserva>/<arquivo>`. O Supabase não permite apagar arquivos por SQL: use o painel (Storage) ou a API. Apagar a reserva remove os registros das fotos, mas **não** os arquivos.
- `tests/filiais.sql`: acesso por filial e por empresa (quem vê o quê, reserva fora da filial, portaria de outra filial, vazamento entre empresas). Autossuficiente; sucesso = `OK_TESTES_PASSARAM`.
- `tests/offline.sql`: leitura de chave com horário do aparelho, pacote offline sem o código da chave e checklist por categoria. Autossuficiente; sucesso = `OK_TESTES_PASSARAM`.

## Modo offline
O aparelho guarda (IndexedDB) o resultado de `minhas_reservas_offline()` e uma fila de leituras e vistorias. `ler_chave(codigo, lido_em)` aceita o horário do aparelho quando ele não está no futuro e tem menos de 48 h. Só funciona na versão publicada (o service worker não roda no `npm run dev`); para testar localmente use `npm run build && npx vite preview`.

## Documentos e termos
- Bucket privado `documentos`, caminho `<empresa>/<pessoa ou veículo>/<arquivo>`. Arquivos não podem ser apagados pelo app (são evidência); para limpar dados de teste, use o painel do Supabase (Storage).
- Documento enviado pelo condutor fica `pendente` até `conferir_documento`; só aprovado e dentro da validade conta. Aprovar uma CNH atualiza a tabela `cnhs` (`app.aplicar_cnh`).
- `termos` não pode ter o texto alterado e `assinaturas_de_termo` é só de inclusão; para nova redação publique uma nova versão. A tela de reserva usa `pendencias_para_reservar(empresa)`.
- `tests/documentos.sql`: autossuficiente; sucesso = `OK_TESTES_PASSARAM`.

## Exceções e rotinas (Sprint 5)
- `pg_cron` roda `app.rotina_minuto()` a cada minuto (expira solicitação, no-show, atraso, realocação) e `app.rotina_diaria()` às 08:07 de Brasília (vencimento de documentos). Ver em `cron.job` e `cron.job_run_details`.
- Pane ou acidente fica em `incidentes` (a tabela `ocorrencias` do Sprint 4 é o registro geral de eventos). A reserva vai para o estado `ocorrencia` e o carro para `bloqueado` até o gestor encerrar.
- Avisos em `notificacoes` (cada pessoa só lê os seus). Faltas e suspensões em `faltas` e `suspensoes`; limites em `politica_padrao()` (`suspensao_faltas`, `suspensao_janela_dias`, `suspensao_dias`, `realocacao_antecedencia_min`).
- `tests/excecoes.sql`: autossuficiente; sucesso = `OK_TESTES_PASSARAM`.

## Relatórios e central (Sprint 6)
- `relatorio_frota(empresa, de, ate, filial)` devolve o resumo, o uso por veículo e a demanda não atendida; `relatorio_reservas(...)` devolve uma linha por reserva (base do CSV). Admin, gestor de frota e financeiro veem a empresa toda; gestor de base, só as filiais liberadas.
- Retirada e devolução reais vêm das vistorias (`app.uso_real`); tempo parado vem de ordens de serviço e incidentes, sem contar sobreposição duas vezes.
- Demanda não atendida: `registrar_demanda_nao_atendida` é chamada pela tela de reserva quando a busca não acha carro; conta pela hora da busca.
- `reservas` e `incidentes` estão na publicação `supabase_realtime` (a central da portaria assina as mudanças; a RLS vale também no tempo real).
- `tests/relatorios.sql`: autossuficiente; sucesso = `OK_TESTES_PASSARAM`.
