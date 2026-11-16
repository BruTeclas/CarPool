-- Testes do Sprint 6 (relatórios). Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
-- Cenário de um dia (ontem), frota de 2 carros:
--   r1 no c1, 08h-12h, retirou 08:10, devolveu 12:40 (atrasou 40 min), 50 km, centro CC-100
--   r2 no c2, 09h-11h, não compareceu
--   r3 no c1, 14h-15h, cancelada fora do prazo
--   c2 parado em oficina de 00h a 06h; uma busca sem carro às 10h
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  tz constant text := 'America/Sao_Paulo';
  d date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  mot uuid := gen_random_uuid(); fin uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
  j jsonb; s jsonb; n int; msg text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 't6-' || u || '@teste.invalid' from unnest(array[mot, fin]) u;
  insert into public.empresas (id, nome) values (e, 'Teste relatórios');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'Pátio');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values
    (c1, e, b, cat, 'REL0001', 'Um'), (c2, e, b, cat, 'REL0002', 'Dois');
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e, mot, 'motorista', 'Mot'), (e, fin, 'financeiro', 'Fin');

  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status, centro_de_custo) values
    (r1, e, c1, mot, mot, (d + time '08:00') at time zone tz, (d + time '12:00') at time zone tz, 'encerrada', 'CC-100'),
    (r2, e, c2, mot, mot, (d + time '09:00') at time zone tz, (d + time '11:00') at time zone tz, 'no_show', null),
    (r3, e, c1, mot, mot, (d + time '14:00') at time zone tz, (d + time '15:00') at time zone tz, 'cancelada', null);
  insert into public.vistorias (empresa_id, reserva_id, veiculo_id, tipo, autor_id, odometro_km, combustivel_pct, criado_em) values
    (e, r1, c1, 'saida', mot, 100, 80, (d + time '08:10') at time zone tz),
    (e, r1, c1, 'chegada', mot, 150, 60, (d + time '12:40') at time zone tz);
  insert into public.eventos_da_reserva (empresa_id, reserva_id, de_status, para_status, detalhe, em) values
    (e, r1, 'em_uso', 'atrasada', '{"automatico": true}', (d + time '12:15') at time zone tz),
    (e, r3, 'aprovada', 'cancelada', '{"cancelamento_tardio": true}', (d + time '13:30') at time zone tz);
  insert into public.ordens_de_servico (empresa_id, veiculo_id, descricao, status, criado_em, concluida_em)
  values (e, c2, 'Troca de óleo', 'concluida', (d + time '00:00') at time zone tz, (d + time '06:00') at time zone tz);
  insert into public.demandas_nao_atendidas (empresa_id, user_id, inicio, fim, em)
  values (e, mot, (d + time '10:00') at time zone tz, (d + time '11:00') at time zone tz, (d + time '07:00') at time zone tz);

  -- 1. Motorista não vê relatório
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.relatorio_frota(e, d, d); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 1: motorista viu relatório (%)', msg; end if;
  begin perform public.registrar_demanda_nao_atendida(e, now() + interval '1 day', now() + interval '1 day 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is not null then raise exception 'FALHOU 1b: motorista não registrou demanda (%)', msg; end if;
  perform public.registrar_demanda_nao_atendida(e, now() + interval '1 day', now() + interval '1 day 1 hour');
  reset role;
  select count(*) into n from public.demandas_nao_atendidas where empresa_id = e;
  if n <> 2 then raise exception 'FALHOU 1c: busca repetida contou % vezes', n - 1; end if;

  -- 2. Financeiro: números do dia
  perform set_config('request.jwt.claims', json_build_object('sub', fin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.relatorio_frota(e, d, d);
  s := j -> 'resumo';
  if (s ->> 'frota')::int <> 2 or (s ->> 'horas_periodo')::numeric <> 24 then raise exception 'FALHOU 2: frota/horas %', s; end if;
  if (s ->> 'utilizacao_pct')::numeric <> 10.7 then raise exception 'FALHOU 2b: utilização % (esperado 10.7)', s ->> 'utilizacao_pct'; end if;
  if (s ->> 'ocupacao_pct')::numeric <> 14.3 then raise exception 'FALHOU 2c: ocupação % (esperado 14.3)', s ->> 'ocupacao_pct'; end if;
  if (s ->> 'disponibilidade_pct')::numeric <> 87.5 then raise exception 'FALHOU 2d: disponibilidade % (esperado 87.5)', s ->> 'disponibilidade_pct'; end if;
  if (s ->> 'reservas')::int <> 3 or (s ->> 'usadas')::int <> 1 or (s ->> 'no_show')::int <> 1
     or (s ->> 'canceladas')::int <> 1 or (s ->> 'cancelamentos_tardios')::int <> 1 then
    raise exception 'FALHOU 2e: contagens %', s; end if;
  if (s ->> 'atrasadas')::int <> 1 or (s ->> 'atraso_medio_min')::int <> 40 then raise exception 'FALHOU 2f: atraso %', s; end if;
  if (s ->> 'km')::int <> 50 or (s ->> 'pico')::int <> 2 then raise exception 'FALHOU 2g: km/pico %', s; end if;
  if (j -> 'demanda' ->> 'total')::int <> 1 then raise exception 'FALHOU 2h: demanda %', j -> 'demanda'; end if;
  if (select (v ->> 'usado_h')::numeric from jsonb_array_elements(j -> 'veiculos') v where v ->> 'placa' = 'REL0001') <> 4.5
     or (select (v ->> 'parado_h')::numeric from jsonb_array_elements(j -> 'veiculos') v where v ->> 'placa' = 'REL0002') <> 6 then
    raise exception 'FALHOU 2i: por veículo %', j -> 'veiculos'; end if;

  -- 3. Lista para o financeiro
  select count(*) into n from public.relatorio_reservas(e, d, d);
  if n <> 3 then raise exception 'FALHOU 3: % linhas', n; end if;
  if not exists (select 1 from public.relatorio_reservas(e, d, d) x
                 where x.centro_de_custo = 'CC-100' and x.km = 50 and x.horas_usadas = 4.5 and x.atrasou) then
    raise exception 'FALHOU 3b: linha da viagem'; end if;
  if not exists (select 1 from public.relatorio_reservas(e, d, d) x where x.centro_de_custo = 'Sem centro de custo') then
    raise exception 'FALHOU 3c: centro vazio'; end if;
  reset role;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
