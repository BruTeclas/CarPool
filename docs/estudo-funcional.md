[Resumo executivo](#resumo) [Problemas a resolver](#problemas) [Mapa de funcionalidades](#modulos) [Perfis e permissões](#perfis) [Ciclo da reserva](#ciclo) [Chaves e acesso](#chaves) [Telemetria](#telemetria) [Regras de negócio](#regras) [Central operacional](#central) [Indicadores](#indicadores) [Simulador de retorno](#simulador) [Mercado e concorrentes](#mercado) [Modelo de negócio](#modelo) [Arquitetura técnica](#arquitetura) [LGPD e riscos](#riscos) [Roadmap](#roadmap) [Decisões do produto](#decisoes) [Fontes](#fontes)

BRASIL

POO1L26

# Car pool corporativo: estudo funcional e de produto

Levantamento completo para um sistema de reserva e controle de veículos compartilhados em empresas com frota avulsa: funcionalidades, fluxo operacional, integração com chaves e telemetria, regras de negócio, indicadores, mercado, modelo de negócio, arquitetura e roadmap.

**—**funcionalidades mapeadas

**14**módulos de produto

**5**níveis de controle de chave

**3**fases de desenvolvimento

## Resumo executivo

O conceito é conhecido no mercado como corporate car sharing ou motor pool management: a empresa mantém um grupo de veículos que não pertence a um motorista fixo, e diferentes colaboradores usam esses carros mediante reserva.

No Brasil a dor é real e pouco atendida. Uma reportagem sobre uma startup do segmento registrou que muitas empresas, inclusive de grande porte, ainda controlam a reserva dos carros em papel ou planilha. O resultado típico é previsível: carro parado enquanto outra área aluga um veículo, ninguém sabe quem causou uma avaria, multa paga pela empresa sem identificar o condutor, e o gestor sem dado para decidir se a frota está grande ou pequena demais.

A recomendação deste estudo é construir o produto em camadas: primeiro um fluxo de reserva, vistoria e devolução impecável, que funciona sem hardware; depois a automação de chave e a integração com telemetria; por fim a inteligência para dimensionar a frota. O diferencial mais defensável não está em nenhuma funcionalidade isolada, e sim em fechar o ciclo completo com evidência: quem reservou, quem retirou, quem dirigiu, em que estado devolveu e quanto custou.

Qual carro está disponível, quem pode usá-lo, quem está com ele agora, quando volta, em que estado e quanto custou.

Se o sistema responder essas seis perguntas com dado confiável, ele vende. Todo o resto é forma de responder melhor ou mais rápido.

## Problemas a resolver

Cada módulo do produto existe para atacar pelo menos um destes cinco problemas. Funcionalidade que não ataca nenhum deles fica fora do escopo.

#### Disponibilidade

Quem vai usar qual veículo, quando e por quanto tempo, sem conflito, sem carro parado por reserva esquecida e sem aluguel desnecessário.

#### Controle de acesso

Só pessoas autorizadas, com CNH válida e dentro da janela reservada, conseguem retirar a chave ou ligar o carro.

#### Responsabilidade

Evidência do estado do veículo na saída e na chegada, de quem estava com ele e do trajeto, para avarias, multas e sinistros.

#### Eficiência financeira

Medir ocupação real, reduzir ociosidade, ratear custos por área e dimensionar a frota com base em demanda comprovada.

#### Conformidade

Habilitação válida, política de uso aceita, identificação de condutor em multas e tratamento de dados pessoais conforme a LGPD.

## Mapa de funcionalidades

Catorze módulos com a fase recomendada para cada funcionalidade. A fase é uma recomendação de priorização, não uma classificação de mercado. Use os filtros para ver o escopo de cada fase.

MVP valida o produto sem hardware Fase 2 automação e integrações Fase 3 inteligência e escala

## Perfis e permissões

Sete perfis cobrem as operações observadas em clientes corporativos. Uma pessoa pode acumular perfis, e as permissões valem por unidade ou base.

| Perfil | O que faz | Onde usa |
| --- | --- | --- |
| Motorista | Reserva, faz vistoria, retira e devolve, comunica ocorrências, consulta histórico próprio. | App (PWA) e WhatsApp |
| Solicitante | Reserva em nome de outra pessoa ou de um visitante cadastrado, sem dirigir. | App e portal |
| Aprovador | Aprova ou recusa reservas que exigem alçada, com justificativa registrada. | WhatsApp, e-mail e portal |
| Gestor de base | Opera um pátio: vistoria de portaria, entrega manual de chave, bloqueios, tratamento de atrasos. | Painel da portaria (tablet ou TV) |
| Gestor de frota | Cadastros, políticas, manutenção, multas, custos, relatórios e dimensionamento. | Portal web |
| Financeiro / controladoria | Somente leitura de custos, rateios e exportações por centro de custo. | Portal web |
| Administrador | Configura empresa, unidades, integrações, usuários, perfis e auditoria. | Portal web |

## Ciclo da reserva

A reserva não termina quando o motorista pega a chave, e a devolução da chave não prova que o carro está pronto para o próximo. O sistema precisa acompanhar o ciclo inteiro como uma máquina de estados.

**Solicitação**Período, finalidade, destino, passageiros e centro de custo

**Validação**CNH, política do grupo, conflito de agenda e intervalo técnico

**Aprovação**Automática ou por alçada, com registro de quem aprovou

**Liberação**Código, QR ou crachá habilitado só na janela da reserva

**Vistoria de saída**Checklist, fotos guiadas, km e combustível

**Em uso**Monitoramento de prazo e, com telemetria, de trajeto

**Devolução**Vistoria de chegada, chave e local de estacionamento

**Encerramento**Comparação de vistorias, custos e liberação do carro

### Exceções que o sistema precisa tratar

**No-show.** Sem retirada em X minutos, a reserva expira, o carro volta para a agenda e a ocorrência fica no histórico do usuário.

**Atraso na devolução.** Alerta ao motorista e ao gestor; se afeta a próxima reserva, o sistema oferece outro veículo ao próximo usuário.

**Avaria nova.** Divergência entre vistorias abre ocorrência com as fotos das duas pontas e o responsável do período.

**Falha crítica no checklist.** Pneu, freio ou luz reprovados bloqueiam o veículo e abrem ordem de manutenção.

**Pane ou acidente em uso.** Botão de ocorrência com localização, contato de assistência e encerramento especial da reserva.

**Equipamento offline.** Armário ou cadeado sem internet funciona com credenciais de uso único pré-carregadas e sincroniza depois.

## Chaves e acesso ao veículo

Este é o ponto de maior diferenciação comercial e também o de maior risco técnico. O hardware será de fabricantes terceiros, e o sistema precisa funcionar completo sem ele. Por isso, são cinco níveis, da frota de cinco carros à de quinhentos.

| Nível | Como funciona | Investimento do cliente em hardware | Quando faz sentido |
| --- | --- | --- | --- |
| 1. Manual auditado | Portaria entrega a chave mediante código da reserva e registra no sistema; vistoria pode ser do motorista ou da portaria. | Nenhum hardware | MVP, frotas pequenas, base com portaria 24h |
| 2. QR Code ou NFC no chaveiro | Cada chave tem uma etiqueta lacrada com QR Code (e opcionalmente NFC). O motorista lê pelo app; o sistema confere se é a chave do carro reservado e registra a retirada e a devolução. | Etiquetas de baixo custo | Padrão do produto sem hardware; qualquer base, qualquer porte |
| 3. Cofre ou cadeado eletrônico | Cofre individual por veículo ou cadeado com código temporário gerado por reserva e válido só na janela. | Baixo | Bases sem portaria, poucos carros por local |
| 4. Armário inteligente | Armário com compartimentos libera só a chave reservada, mediante PIN, QR, crachá RFID ou biometria; sensor confirma presença da chave. | Médio a alto | Bases com 15 ou mais carros e alto giro |
| 5. Acesso sem chave | Dispositivo no veículo destrava pelo app via Bluetooth ou rede móvel e libera a partida só durante a reserva. | Alto por veículo | Frotas distribuídas, bases sem infraestrutura, operação 24h |

### Modo sem hardware: QR Code ou NFC no chaveiro

É o modo padrão do produto e o que torna a venda possível sem investimento em equipamento. Cada chave recebe uma etiqueta lacrada, à prova de violação, com um identificador opaco: o código não contém a placa nem dados do carro, só uma referência que o sistema resolve. Uma etiqueta NFC no mesmo chaveiro permite a leitura por aproximação, útil em ambientes com pouca luz.

**Leitura**Motorista lê o QR pelo app ou pela câmera do celular, que abre o app já autenticado

**Conferência**Sistema verifica reserva ativa do usuário, veículo correspondente e janela de horário

**Retirada registrada**Hora, local do celular e usuário; a vistoria de saída abre em seguida

**Confirmação no carro**Opcional: segundo QR no para-brisa confirma que chave e carro batem

**Devolução**Nova leitura, vistoria de chegada, foto da vaga e encerramento

### Respostas do sistema na leitura

**Chave certa.** Tela de confirmação com placa, modelo e vaga; a retirada é registrada e a vistoria de saída começa.

**Chave errada.** Alerta em tela informando qual carro e qual vaga correspondem à reserva; a tentativa fica registrada e o gestor de base é avisado.

**Sem reserva.** Se o carro estiver livre e a política permitir, o sistema oferece reserva imediata; caso contrário, bloqueia e mostra os próximos horários livres.

**Fora da janela.** Leitura antes do horário reservado aguarda; depois da tolerância, a reserva já expirou como no-show e o motorista precisa reservar de novo.

**Leitura por quem não está logado.** Mostra só uma ficha mínima do veículo (modelo, base e contato da frota), sem dados de pessoas nem de reservas.

**Sem internet.** O app guarda a leitura com carimbo de tempo e valida contra a reserva já baixada no aparelho; sincroniza quando o sinal volta.

Limite a deixar claro na venda: o QR Code não impede fisicamente que alguém pegue a chave. Ele funciona por registro e dissuasão. Para fechar essa lacuna sem hardware de chave, há três complementos: quadro de chaves sob responsabilidade da portaria, telemetria de terceiro confirmando ignição e condutor (uso sem leitura vira ocorrência automática), ou a evolução para cofre ou armário na mesma base.

### Pontos de engenharia que não podem ficar para depois

#### Abrir não é retirar

O evento de abertura do compartimento não prova que a chave saiu. O registro válido é o do sensor de presença; sem sensor, a confirmação vem da vistoria de saída ou da telemetria.

#### Credencial de uso único

Cada liberação usa um token assinado, com validade curta e vinculado à reserva, ao usuário e ao compartimento. Reutilização é recusada e registrada.

#### Comandos idempotentes

Comandos ao equipamento têm identificador próprio; repetição por falha de rede não gera dupla abertura nem duplo registro.

#### Camada de adaptadores

Cada fabricante entra por um adaptador que traduz para eventos padrão do sistema. O produto nunca depende de um único fornecedor de armário ou de dispositivo.

Bloqueio de partida só deve agir com o veículo parado e desligado, impedindo a próxima partida. Interromper um veículo em movimento é risco à vida e não deve existir no produto.

## Telemetria: a camada que fecha o ciclo

Sem telemetria, o sistema depende do que o motorista digita. Com ela, quilometragem, combustível, trajeto, identificação do condutor e devolução passam a ser confirmados por dado do próprio veículo. É também o recurso que transforma o produto de agenda em ferramenta de auditoria.

Há um ponto estratégico aqui: boa parte das frotas corporativas brasileiras já tem rastreador instalado. Um car pool que consome a telemetria existente via API, em vez de exigir novo hardware, reduz o custo de entrada do cliente e cria uma oferta natural para empresas de telemetria venderem como módulo adicional à base instalada.

| Dado da telemetria | O que habilita no car pool |
| --- | --- |
| Odômetro e combustível | Vistoria sem digitação, custo por km real, detecção de abastecimento incompatível |
| Ignição e posição | Início e fim automáticos da reserva, devolução detectada na base, alerta de uso sem reserva |
| Identificação do condutor | Cruzamento entre quem reservou e quem dirigiu; prova para indicação em multas |
| Cercas virtuais | Área permitida por política, chegada à base, saída fora do horário |
| Eventos de condução | Score por motorista, treinamento direcionado, critério para suspensão |
| Diagnóstico do veículo | Bloqueio preventivo por falha, bateria baixa, manutenção antes da próxima reserva |

## Regras de negócio configuráveis

Valores entre parênteses são sugestões de padrão; cada empresa, unidade ou grupo de usuários pode alterar.

1. Antecedência mínima para reservar (1 hora) e máxima (60 dias).
2. Duração máxima por reserva (12 horas) e por semana por usuário (configurável).
3. Intervalo técnico obrigatório entre duas reservas do mesmo carro (30 minutos).
4. Tolerância para retirada antes do no-show (30 minutos).
5. Tolerância de atraso na devolução antes do alerta ao gestor (15 minutos).
6. Reserva com pernoite, fim de semana ou viagem acima de X km exige aprovação.
7. CNH vencida, suspensa ou com categoria incompatível bloqueia a reserva no momento da solicitação e novamente na retirada.
8. Revalidação visual da CNH pelo gestor a cada 6 meses.
9. Política de uso precisa ser aceita na versão vigente antes da primeira reserva após qualquer atualização.
10. Fotos mínimas obrigatórias na saída e na chegada (frente, traseira, duas laterais e painel).
11. Item crítico reprovado no checklist bloqueia o veículo até liberação da manutenção.
12. Reserva por categoria: o sistema escolhe a placa priorizando o carro mais próximo da revisão ou com menor km no mês, para equilibrar o desgaste.
13. Prioridade de reserva por perfil ou urgência, com aviso ao usuário eventualmente deslocado e oferta de alternativa.
14. Três no-shows ou atrasos graves em 30 dias geram suspensão temporária, com aviso prévio.
15. Multa recebida é atribuída automaticamente ao condutor da reserva ativa na data e hora da infração, com prazo interno para indicação.
16. Combustível devolvido abaixo do nível retirado gera ocorrência (se a política exigir devolução no mesmo nível).
17. Carro elétrico só pode ser reservado se a autonomia prevista cobrir a distância declarada com margem (20%).
18. Cancelamento até X horas antes não conta como no-show.

## Central operacional

Simulação da tela mais usada pelo gestor de base: agenda do dia por veículo, com status atual. Toque nos números para filtrar e nos blocos para ver o detalhe. Dados fictícios.

**Base São Paulo · hoje**Agora: 14:40

Reservado Em uso Atrasado Concluído Manutenção

Selecione uma reserva para ver o detalhe.

## Indicadores

O gestor precisa responder uma pergunta: estou usando bem a frota ou pagando por carros que poderiam sair? Estes indicadores respondem.

| Indicador | Cálculo | O que revela |
| --- | --- | --- |
| Taxa de ocupação | Horas reservadas ÷ horas disponíveis no período | Quanto da capacidade está comprometida na agenda |
| Taxa de utilização | Horas em uso real ÷ horas disponíveis | Uso efetivo; a diferença para a ocupação é reserva desperdiçada |
| Reservas não utilizadas | No-shows + horas reservadas sem movimento | Carros bloqueados sem necessidade |
| Demanda não atendida | Tentativas recusadas por falta de veículo | Se a frota está pequena, e em quais dias e horários |
| Pico simultâneo | Máximo de carros em uso ao mesmo tempo no mês | O número real de carros que a base precisa |
| Custo por km | Custo total do veículo ÷ km rodados | Eficiência por carro, categoria e área |
| Custo por reserva | Custo total ÷ reservas concluídas | Base para comparar com locadora e aplicativo |
| Índice de atraso | Devoluções atrasadas ÷ total | Impacto na reserva seguinte e na disciplina dos usuários |
| Avarias por mil km | Avarias atribuídas ÷ km × 1.000 | Risco por motorista e por área |
| Disponibilidade operacional | Horas aptas ÷ horas totais | Peso de manutenção e bloqueios |
| Multas identificadas | Multas com condutor indicado ÷ total recebido | Custo evitado de multas assumidas pela empresa |

## Simulador de retorno

Projeção ilustrativa para usar em conversa com cliente. A redução de frota parte da premissa de elevar a ocupação média sem deixar de atender a demanda; ela precisa ser comprovada com o histórico de uso do próprio cliente.

Veículos no pool Custo mensal total por veículo (R$) Ocupação média atual Ocupação-alvo com o sistema Reservas por mês Minutos de controle manual por reserva hoje Custo da hora administrativa (R$) Multas por mês sem condutor identificado Valor médio por multa assumida (R$)

Veículos necessários na ocupação-alvo**—**

Economia mensal com frota**—**

Economia mensal administrativa (80% do tempo manual)**—**

Multas evitadas por mês**—**

Economia anual potencial**—**

Valores hipotéticos. Dependem da curva de demanda, de contratos de locação vigentes e da disciplina de uso. Um fornecedor europeu estima o controle manual de chave e diário de bordo em cerca de 5 minutos por reserva, referência usada para o padrão acima.

## Mercado e concorrentes

O segmento está mais maduro na Europa, onde software de reserva e fabricantes de armários e de telemetria trabalham integrados. No Brasil há poucas soluções dedicadas e muita gestão manual.

| Solução | Origem | O que oferece | O que aprender |
| --- | --- | --- | --- |
| Fleetster | Alemanha | Software de corporate car sharing com armário de chaves integrado, kits sem chave de vários fabricantes, realocação automática de reservas, contratos de reserva e uso particular com repasse ao RH. | Referência de escopo completo e de modelo de integração com vários fabricantes de hardware. |
| Rosenberger Commander + Traka | Alemanha | Reserva no portal ou app; armário libera a chave só ao usuário autorizado e só na janela; cada movimento vinculado à reserva e ao centro de custo. | O fluxo ponta a ponta reserva → chave → trajeto → rateio é o argumento de venda. |
| Traka (ASSA ABLOY) | Reino Unido | Armários com controle por chave, registro de km e de vaga na devolução, distribuição de uso entre veículos, integração com sistemas externos. | Candidato a equipamento homologado; vale entender a API e quem representa a marca no Brasil. |
| INVERS CloudBoxx | Alemanha | Unidade telemática dedicada a compartilhamento, com acesso sem chave e alternância para Bluetooth sem sinal. | Referência técnica para o nível 4 de acesso e para operação em garagem subterrânea. |
| Geotab Keyless / Keybox | Canadá | Kits de acesso sem chave via OBD ou caixa de chave no veículo, integrados a softwares de car sharing. | Mostra o caminho de reaproveitar telemetria existente em vez de instalar hardware novo. |
| Joycar | Brasil | Dispositivo próprio homologado pela Anatel, abertura pelo app ou crachá, partida só com veículo liberado, checklist pós-viagem e módulo de carona. | Concorrente direto mais próximo; prova que existe comprador corporativo no Brasil. |
| Keyworks | Brasil | Projeto sob encomenda para agendamento e reserva de carros na Agrale, com foco em evitar locações desnecessárias. | Parte do mercado ainda é atendida por desenvolvimento customizado: espaço para produto padronizado. |
| Minha Frota (Copastur) | Brasil | Reserva com escolha de data e local de retirada e devolução e histórico de reservas, ligada a uma agência de viagens corporativas. | Mobilidade corporativa também entra pelo canal de viagens e RH, não só pela gestão de frota. |

### Onde há espaço

#### Telemetria já instalada

Consumir dados do rastreador que o cliente já tem, em vez de exigir dispositivo novo, derruba a barreira de entrada.

#### Hardware acessível

Cofre ou cadeado eletrônico de baixo custo para bases pequenas, que os armários importados não atendem bem.

#### WhatsApp como canal

Reservar, aprovar, receber código e comunicar ocorrência pelo canal que o colaborador brasileiro já usa.

#### Frotas médias

Empresas com 10 a 200 carros compartilhados, grandes demais para planilha e pequenas para projeto customizado.

## Modelo de negócio

Estrutura recomendada para SaaS B2B. Os valores devem ser definidos depois de entrevistas com 5 a 10 gestores de frota, comparando com o custo mensal de um carro parado.

| Plano | Inclui | Perfil de cliente |
| --- | --- | --- |
| Essencial | Reservas, aprovações, CNH, vistoria com fotos, chave manual auditada, notificações, relatórios básicos. | Até 20 carros, uma ou duas bases |
| Profissional | Tudo do Essencial + integração com cofre, armário e telemetria de terceiros, manutenção, multas, custos, WhatsApp, painel de portaria. | 20 a 200 carros, várias bases |
| Corporativo | Tudo do Profissional + integração com acesso sem chave, inteligência e dimensionamento, SSO, API, white label, SLA dedicado. | Grandes contas e multinacionais |

#### Unidade de cobrança

Faturamento mensal por veículo ativo. Alinha preço ao valor (custo do carro) e cresce junto com o cliente.

#### Hardware fora da venda

O produto comercializa só o sistema. Armários, cofres, cadeados e dispositivos são comprados ou locados pelo cliente direto do fabricante; o sistema se integra a uma lista de equipamentos homologados.

#### Implantação

Taxa única para cadastro, configuração de políticas, impressão das etiquetas de QR, conexão com o hardware e a telemetria do cliente e treinamento das bases.

#### Canal

Venda direta e parceria com empresas de telemetria, locadoras de frota e gestoras de mobilidade, que revendem como módulo.

## Arquitetura técnica

| Camada | Tecnologia possível | Observação |
| --- | --- | --- |
| App do motorista | PWA responsiva (React ou similar) | Câmera para vistoria, funciona com sinal fraco, sem passar por loja na fase 1 |
| Portal do gestor | Aplicação web | Agenda, cadastros, políticas, relatórios |
| Painel da portaria | Web em tablet ou TV | Modo quiosque, atualização em tempo real |
| Backend | TypeScript com API REST e webhooks | Máquina de estados da reserva no servidor, nunca no cliente |
| Banco de dados | PostgreSQL (Supabase) | Isolamento por empresa com políticas de linha (RLS) |
| Arquivos | Armazenamento de objetos | Fotos de vistoria com data, hora, local e hash para provar integridade |
| Automação e filas | n8n e fila de jobs | Lembretes, no-show, expiração de tokens, relatórios |
| Mensageria | WhatsApp Business API, e-mail, push | Assistente conversacional para reservas e aprovações |
| Hardware | Serviço de adaptadores por fabricante | Traduz eventos de armário, cadeado e dispositivo em eventos padrão |
| Telemetria | Conectores por API dos fornecedores | Odômetro, ignição, posição, condutor |
| IA | Modelos de visão e de linguagem via API | Comparação de fotos, OCR de odômetro e cupom, assistente |

### Garantia de que não haverá reserva duplicada

Conflito de agenda não deve ser checado só na aplicação, porque duas pessoas podem reservar o mesmo carro no mesmo segundo. O PostgreSQL resolve isso no próprio banco com uma restrição de exclusão sobre intervalos de tempo:

```
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservas ADD CONSTRAINT sem_sobreposicao
  EXCLUDE USING gist (
    veiculo_id WITH =,
    tstzrange(inicio, fim + intervalo_tecnico) WITH &&
  ) WHERE (status IN ('aprovada','liberada','em_uso','atrasada'));
```

### Entidades principais do modelo de dados

Empresa, Unidade, Base, Vaga, Veículo, Categoria, Usuário, CNH, Grupo, Política, Reserva, EventoDaReserva, Aprovação, Vistoria, ItemDeVistoria, Foto, Avaria, Chave, Dispositivo, EventoDeDispositivo, CredencialDeAcesso, Ocorrência, OrdemDeServiço, Abastecimento, Multa, CentroDeCusto, Notificação e RegistroDeAuditoria. Toda mudança de estado da reserva gera um EventoDaReserva imutável, o que dá a trilha de auditoria sem esforço adicional.

## LGPD e riscos

O sistema trata CNH, fotos, localização e comportamento de condução de colaboradores. Esses dados identificam pessoas e exigem cuidado desde o desenho.

| Risco | Mitigação |
| --- | --- |
| Base legal frágil | Em relação de emprego, o consentimento costuma ser base frágil. O cliente (controlador) deve definir a base legal com seu jurídico; o produto oferece aviso de privacidade configurável e registro de ciência. |
| Localização fora do trabalho | Coletar posição apenas durante reservas ativas; uso particular autorizado com regra própria de coleta e retenção. |
| Retenção indefinida | Prazos configuráveis por tipo de dado, com anonimização automática de trajetos e eliminação de fotos após o período definido. |
| Acesso excessivo | Perfis com mínimo privilégio; gestor de base não vê trajeto detalhado de outras unidades; tudo auditado. |
| Direitos do titular | Exportação dos dados do colaborador e fluxo para correção e eliminação. |
| Contestação de avaria | Fotos com carimbo de tempo, local e hash; comparação lado a lado; IA só sinaliza, decisão é humana. |
| Falha de hardware travando a operação | Contingência offline com códigos de uso único e procedimento manual documentado na portaria. |
| Dependência de um fornecedor | Camada de adaptadores; nenhum dado de negócio guardado só no sistema do fabricante. |
| Baixa adesão dos usuários | Reserva em até três toques, WhatsApp como canal, e o carro só sai com reserva, o que torna o uso obrigatório na prática. |

Este estudo não substitui avaliação jurídica. Antes de vender, vale um parecer sobre tratamento de dados de empregados e um modelo de contrato de operador de dados.

## Roadmap

MVP

#### Validar o produto sem hardware

Cadastro de frota, bases e usuários; CNH com bloqueio; reservas com prevenção de conflito; políticas e aprovações; vistoria de saída e chegada com fotos; chave manual auditada e chaveiro com QR Code ou NFC; no-show e atraso; notificações; portal do gestor; relatórios de ocupação e demanda não atendida; trilha de auditoria; multiempresa.

Critério de sucesso: piloto pago em um cliente com 15 a 40 carros, 90% das retiradas com reserva no sistema e primeira medição confiável de ocupação.

Fase 2

#### Automatizar e integrar

Cofre, cadeado e armário inteligente com adaptadores; telemetria (km, ignição, condutor, devolução automática); manutenção e vencimentos; multas com identificação de condutor; abastecimento e custos com rateio; assistente no WhatsApp; painel de portaria; SSO e integração com RH; API.

Critério de sucesso: retirada e devolução sem intervenção humana em pelo menos uma base; redução mensurável de multas sem condutor identificado.

Fase 3

#### Inteligência e escala

Acesso sem chave; recomendação de veículo; carona corporativa; dimensionamento de frota; previsão de demanda e de atrasos; IA em vistorias e OCR; indicadores ESG; white label.

Critério de sucesso: relatório de dimensionamento usado pelo cliente para devolver ou deixar de contratar veículos.

## Decisões do produto

Escolhas que definem o desenho do produto e o que cada uma implica na especificação.

| Tema | Decisão | Implicação na especificação |
| --- | --- | --- |
| Posicionamento | Produto independente, com possibilidade de integrar telemetria de terceiros. | O produto é completo sem telemetria. A integração entra por conectores que traduzem cada fornecedor em eventos padrão (odômetro, ignição, posição, condutor). Priorizar os dois ou três fornecedores mais comuns nos primeiros clientes. |
| Hardware de chave | De terceiros, com modo de operação sem hardware. | O QR Code ou NFC no chaveiro vira o padrão do MVP. Armários e cofres entram pela camada de adaptadores, sem mudar o fluxo da reserva. |
| Público | Qualquer setor que precise da solução. | Produto horizontal: políticas, checklists por tipo de veículo e campos da reserva precisam ser configuráveis, sem regra fixa de setor. Para a prospecção, ainda vale escolher dois ou três setores de entrada, porque acelera a montagem de lista e a criação de casos de referência. |
| Cobrança | Faturamento mensal só do sistema; nenhum equipamento é vendido ou cedido. | Sem investimento em estoque nem risco de equipamento no contrato. Em troca, o produto depende de o cliente adquirir o hardware por conta própria: é preciso manter uma lista de equipamentos homologados, documentar a integração de cada um e, se fizer sentido, firmar acordos de indicação com os fabricantes. O modo QR Code garante que nenhuma venda fique travada pela falta de hardware. |
| Cliente-piloto | A definir. | As métricas abaixo são sugestões para negociar com o piloto antes de começar, já com a medição de ponto de partida. |

### Métricas sugeridas para o piloto

#### Adesão

Percentual de retiradas com reserva e leitura de QR registradas. Meta sugerida: 90% ou mais a partir do segundo mês.

#### Responsabilidade

Percentual de avarias e multas com responsável identificado. Comparar com o período anterior ao sistema.

#### Eficiência

Taxa de ocupação medida e pico simultâneo por base, entregues num relatório de dimensionamento ao fim do piloto.

## Fontes

- [Fleetster — Corporate CarSharing](https://fleetster.net/corporate-carsharing)
- [Fleetster — armário eletrônico de chaves](https://fleetster.net/automatic-keybox)
- [Fleetster — realocação de reservas](https://fleetster.net/fleet-software/corporate-carsharing/reallocation)
- [Fleetster — kits de car sharing (Geotab, Invers)](https://fleetster.net/car-sharing-kit)
- [Rosenberger Telematics — parceria Commander e Traka](https://rosenberger-telematics.com/en/blog/traka-partnership.html)
- [Traka — gestão de chaves de frota](https://www.traka.com/traka-americas/en/solutions/electronic-key-management-systems/fleet-key-management)
- [INVERS — unidade telemática para car sharing](https://invers.com/en/academy/car-sharing-telematics-unit)
- [Mobile Time — Joycar automatiza carsharing corporativo no Brasil (2021)](https://www.mobiletime.com.br/noticias/10/08/2021/joycar-startup-automatiza-car-sharing-corporativo-no-brasil/)
- [Baguete — Agrale controla frota com sistema da Keyworks](https://www.baguete.com.br/noticias/agrale-controla-frota-com-sistema-da-keyworks)
- [Copastur — Minha Frota (FAQ)](https://chamados.copastur.com.br/support/solutions/articles/15000100134)