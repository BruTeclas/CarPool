---
name: carpool-dominio
description: Regras de negócio configuráveis, perfis e permissões, níveis de controle de chave, fases do roadmap e cuidados de LGPD do car pool corporativo. Use ao definir políticas, permissões, escopo de MVP/Fase 2/Fase 3, modelagem de dados ou tratamento de dados pessoais (CNH, fotos, localização).
---

# Domínio do car pool

Fonte completa: `docs/estudo-funcional.md`. Em caso de dúvida, o estudo prevalece.

## Seis perguntas que o sistema deve responder com dado confiável

Qual carro está disponível, quem pode usá-lo, quem está com ele agora, quando volta, em que estado e quanto custou. Funcionalidade que não ajuda a responder alguma delas fica fora do escopo.

## Perfis (acumuláveis, permissões por unidade/base)

Motorista, Solicitante, Aprovador, Gestor de base, Gestor de frota, Financeiro (somente leitura), Administrador.

## Empresa e filiais

Cada empresa só vê os próprios dados. Dentro da empresa, cada pessoa só vê e reserva veículos das filiais (`unidades`) liberadas para ela em `membro_unidades`; admin e gestor de frota veem todas. Tabela ou função nova que exponha veículo, base, chave ou reserva precisa respeitar a filial (`app.unidades_do_usuario()`), além do `empresa_id`.

## Regras configuráveis (padrões sugeridos; por empresa, unidade ou grupo)

1. Antecedência mínima 1 h, máxima 60 dias.
2. Duração máxima 12 h por reserva; limite semanal por usuário configurável.
3. Intervalo técnico entre reservas: 30 min.
4. Tolerância de retirada antes do no-show: 30 min.
5. Tolerância de atraso antes do alerta: 15 min.
6. Pernoite, fim de semana ou viagem acima de X km exige aprovação.
7. CNH vencida/suspensa/categoria incompatível bloqueia na solicitação e de novo na retirada.
8. Revalidação visual da CNH pelo gestor a cada 6 meses.
9. Política de uso aceita na versão vigente antes da primeira reserva após atualização.
10. Fotos mínimas na saída e na chegada: frente, traseira, duas laterais, painel.
11. Item crítico reprovado bloqueia o veículo até liberação da manutenção.
12. Reserva por categoria: escolher a placa mais próxima da revisão ou com menor km no mês.
13. Prioridade por perfil/urgência, com aviso e alternativa ao usuário deslocado.
14. Três no-shows ou atrasos graves em 30 dias geram suspensão temporária, com aviso prévio.
15. Multa atribuída ao condutor da reserva ativa na data/hora da infração.
16. Combustível abaixo do retirado gera ocorrência (se a política exigir).
17. Carro elétrico: autonomia deve cobrir a distância declarada com margem de 20%.
18. Cancelamento até X horas antes não conta como no-show.

Nada disso é regra fixa no código: tudo vem de tabela de políticas.

## Níveis de chave (adaptadores por fabricante, fluxo da reserva não muda)

1 manual auditado · 2 QR/NFC no chaveiro (**padrão do MVP, sem hardware**) · 3 cofre/cadeado · 4 armário inteligente · 5 acesso sem chave.
QR contém identificador opaco (nunca placa ou dados do carro). QR não impede fisicamente a retirada: funciona por registro e dissuasão.

## Fases

- **MVP:** cadastro de frota/bases/usuários, CNH com bloqueio, reservas sem conflito, políticas e aprovações, vistorias com fotos, chave manual + QR/NFC, no-show e atraso, notificações, portal do gestor, relatórios de ocupação e demanda não atendida, auditoria, multiempresa.
- **Fase 2:** adaptadores de cofre/armário, telemetria, manutenção, multas, custos e rateio, WhatsApp, painel de portaria, SSO, API.
- **Fase 3:** acesso sem chave, recomendação, carona, dimensionamento, previsão, IA em vistorias, ESG, white label.

## LGPD

- Coletar posição só durante reservas ativas; uso particular com regra própria.
- Retenção configurável por tipo de dado, com anonimização de trajetos e eliminação de fotos.
- Mínimo privilégio; tudo auditado; exportação/correção/eliminação dos dados do titular.
- Fotos com data, hora, local e hash. IA só sinaliza; a decisão é humana.
- Base legal é do cliente (controlador); o produto oferece aviso de privacidade configurável e registro de ciência.
