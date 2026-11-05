---
name: carpool-reserva
description: Máquina de estados da reserva do car pool corporativo, exceções (no-show, atraso, avaria, pane, offline) e a restrição de exclusão no PostgreSQL que impede reserva duplicada. Use ao implementar ou alterar reservas, vistorias, retirada/devolução, eventos da reserva ou jobs de expiração.
---

# Reserva no car pool

Fonte completa: `docs/estudo-funcional.md`. A máquina de estados vive **no servidor**, nunca no cliente.

## Estados e transições

solicitada → validada → aprovada → liberada → em_uso → devolvida → encerrada

Estados ativos para conflito de agenda: `aprovada`, `liberada`, `em_uso`, `atrasada`.
Estados terminais de exceção: `no_show`, `cancelada`, `encerrada_especial` (pane/acidente).

| Etapa | O que valida |
|---|---|
| Validação | CNH (na solicitação e de novo na retirada), política do grupo, conflito de agenda, intervalo técnico |
| Aprovação | Automática ou por alçada; registrar quem aprovou e a justificativa |
| Liberação | Código/QR/crachá válido só na janela da reserva; token assinado, uso único |
| Vistoria de saída | Fotos (frente, traseira, 2 laterais, painel), km, combustível |
| Devolução | Vistoria de chegada, chave, foto da vaga |
| Encerramento | Compara vistorias, fecha custos, libera o carro |

Toda mudança de estado grava um `EventoDaReserva` **imutável** (sem UPDATE/DELETE). É a trilha de auditoria.

## Exceções

- **No-show:** sem retirada em 30 min, a reserva expira, o carro volta para a agenda e fica no histórico do usuário.
- **Atraso:** alerta ao motorista e ao gestor após 15 min; se afeta a próxima reserva, oferecer outro veículo ao próximo usuário.
- **Avaria nova:** divergência entre vistorias abre ocorrência com fotos das duas pontas.
- **Falha crítica no checklist** (pneu, freio, luz): bloqueia o veículo e abre ordem de manutenção.
- **Pane/acidente:** botão de ocorrência com localização e encerramento especial.
- **Offline:** credenciais de uso único pré-carregadas; leituras guardadas com carimbo de tempo e sincronizadas depois.

## Sem reserva duplicada (garantia no banco)

Nunca confiar só na aplicação:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservas ADD CONSTRAINT sem_sobreposicao
  EXCLUDE USING gist (
    veiculo_id WITH =,
    tstzrange(inicio, fim + intervalo_tecnico) WITH &&
  ) WHERE (status IN ('aprovada','liberada','em_uso','atrasada'));
```

Atenção: com `timestamptz`, `fim + intervalo_tecnico` é `STABLE`, não `IMMUTABLE`, e o Postgres recusa a expressão no `EXCLUDE`. Use uma coluna `bloqueio_fim timestamptz`, preenchida por trigger `BEFORE INSERT/UPDATE` com `fim + intervalo_tecnico` (intervalo vindo da política), e faça a restrição sobre `tstzrange(inicio, bloqueio_fim)`. Valide com teste de concorrência.

## Regras de engenharia

- Comandos a equipamento são idempotentes (id próprio por comando).
- Abrir compartimento ≠ retirar chave: o registro válido vem do sensor de presença, da vistoria de saída ou da telemetria.
- Nunca bloquear veículo em movimento; bloqueio de partida só com veículo parado e desligado.
- Isolamento por empresa com RLS em todas as tabelas.
