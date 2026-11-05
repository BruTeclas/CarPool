# Plano de construção do MVP

Base: `estudo-funcional.md`. Meta do MVP: piloto pago com 15 a 40 carros, 90% das retiradas com reserva no sistema e primeira medição confiável de ocupação. **Sem hardware**: chave manual auditada e QR/NFC no chaveiro.

## Decisões de partida (mudar só se houver motivo)

| Tema | Decisão | Por quê |
|---|---|---|
| Frontend | Um app React + TypeScript + Vite, instalável (PWA), com rotas por perfil (motorista, portaria, gestor) | Um código só; sem loja de apps na fase 1 |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions | Já definido no estudo; RLS dá o isolamento por empresa |
| Regras críticas | Funções SQL e Edge Functions; o cliente nunca muda o estado da reserva sozinho | A máquina de estados fica no servidor |
| Projeto Supabase | **Próprio do CarPool** | Dados de CNH e fotos exigem banco isolado de qualquer outro produto |
| Repositório | `BruTeclas/CarPool`, com código, banco, domínio e hospedagem próprios | Projeto independente de qualquer outro produto |

## Estrutura de pastas prevista

```
/ (raiz do repositório CarPool)
  docs/                  estudo e este plano
  supabase/
    migrations/          schema versionado
    functions/           expirar-no-show, alertar-atraso, assinar-token
    tests/               testes de RLS e de conflito
  app/                   React + Vite + TS (PWA)
    src/{features,lib,routes}
```

## Etapas

Cada etapa termina com algo que se consegue ver funcionando. Ordem pensada para o risco maior vir primeiro.

### Etapa 0 · Fundação (1 a 2 dias)
- Criar o projeto Supabase e o app Vite/React/TS com PWA e lint.
- Variáveis de ambiente, CI mínimo (lint, tipos, testes).
- **Pronto quando:** app abre, loga um usuário de teste e lê uma tabela protegida.

### Etapa 1 · Modelo de dados e segurança (3 a 4 dias) · maior risco
- Migrations: empresa, unidade, base, vaga, categoria, veículo, usuário, CNH, grupo, política, reserva, evento da reserva, chave, vistoria, item, foto, avaria, ocorrência, registro de auditoria.
- RLS em **todas** as tabelas por `empresa_id` e por perfil (7 perfis do estudo).
- Restrição de exclusão contra reserva duplicada. Cuidado: `intervalo_tecnico` precisa ser coluna da reserva, copiada da política na criação.
- `evento_da_reserva` imutável (sem UPDATE/DELETE, nem para admin).
- **Testes que provam:** duas reservas simultâneas no mesmo carro, uma falha; usuário de uma empresa não lê dados de outra; evento não pode ser alterado.
- Skills: `supabase`, `supabase-postgres-best-practices`, `carpool-reserva`.

### Etapa 2 · Cadastros e políticas (3 dias)
- Portal do gestor: veículos, bases, vagas, usuários, perfis, CNH (validade e categoria), grupos.
- Políticas configuráveis (as 18 regras do estudo) lidas de tabela, nunca fixas no código.
- Aceite de política por versão.
- **Pronto quando:** gestor cadastra uma frota de ponta a ponta.

### Etapa 3 · Reserva e aprovação (4 dias)
- Solicitar reserva, validar CNH e política, aprovação automática ou por alçada.
- Transições de estado em função SQL única (`transicionar_reserva`), gravando o evento a cada passo.
- Reserva por categoria (escolhe a placa).
- **Pronto quando:** motorista reserva em até 3 toques, aprovador decide, conflito é recusado com mensagem clara.

### Etapa 4 · Chave, retirada e vistoria (5 dias)
- QR com identificador opaco por chave; leitura no app com os 6 comportamentos do estudo (certa, errada, sem reserva, fora da janela, sem login, sem internet).
- Retirada manual auditada pelo painel da portaria.
- Vistoria de saída e chegada: checklist, fotos guiadas com data, hora, local e hash, km e combustível.
- Divergência entre vistorias abre avaria; item crítico reprovado bloqueia o carro.
- Modo offline: reserva baixada no aparelho, fila de sincronização.
- **Pronto quando:** ciclo completo reserva → retirada → uso → devolução → encerramento roda no celular.

### Etapa 5 · Exceções e rotinas (3 dias)
- Jobs: no-show (30 min), alerta de atraso (15 min), suspensão por 3 ocorrências em 30 dias.
- Notificações por e-mail e push (WhatsApp fica para a Fase 2).
- **Pronto quando:** cada exceção do estudo tem um teste automatizado.

### Etapa 6 · Central da portaria e relatórios (3 dias)
- Painel em tablet/TV com agenda do dia e status em tempo real (Realtime).
- Relatórios de ocupação, utilização, reservas não usadas, demanda não atendida e pico simultâneo.
- **Pronto quando:** o gestor responde "a frota está grande ou pequena?" com dado.

### Etapa 7 · LGPD, auditoria e piloto (3 a 4 dias)
- Aviso de privacidade e registro de ciência; retenção configurável; exportação e eliminação de dados do titular.
- Revisão de segurança, revisão de UI e de acessibilidade, teste de ponta a ponta com Playwright.
- Implantação no cliente-piloto: cadastro, impressão das etiquetas QR, treinamento.

Total estimado: cerca de 5 a 6 semanas de trabalho focado.

## Fora do MVP (não construir agora)
Armário, cofre, acesso sem chave, telemetria, multas, abastecimento, rateio de custos, WhatsApp, SSO, API pública, IA em fotos, carona.

## Riscos a vigiar
1. **Reserva duplicada ou estado alterado fora do servidor.** Mitigação: etapa 1 e testes de concorrência.
2. **Vazamento entre empresas.** Mitigação: RLS testada com dois tenants em toda tabela nova.
3. **Câmera e offline no PWA variam por aparelho.** Mitigação: testar em Android e iPhone reais na etapa 4.
4. **Adesão baixa.** Mitigação: reserva em 3 toques e métrica de retiradas com reserva desde o primeiro dia.
5. **Base legal de dados de empregados.** Mitigação: parecer jurídico antes do piloto (o estudo não substitui).

## Em aberto (preciso de você)
1. Posso criar o projeto Supabase novo? (Vai ser necessário escolher a organização e o custo.)
2. Já existe cliente-piloto? Mudaria a ordem se ele exigir algo cedo (ex.: portaria 24h).
3. Nome do produto e domínio, para configurar e-mails e o PWA.

## Decisões confirmadas
- Projeto Supabase criado: `carpool-corporativo` (ref `lsqssnerbocisxmhxfag`, região `sa-east-1`, organização BruTeclas).
- Sem cliente-piloto por enquanto: segue a ordem das etapas acima.
- Sem nome definitivo nem domínio: o PWA usa o nome provisório "Car Pool Corporativo". Teste em ambiente de desenvolvimento e publicação depois.

## Andamento
- [x] Etapa 0: projeto Supabase, app Vite/React/TS com PWA, cliente Supabase, build e lint passando.
