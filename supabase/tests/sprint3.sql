-- Testes do Sprint 3. Autossuficiente: cria empresa e usuários próprios e desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'. Qualquer outra mensagem é falha.
do $$
declare
  tz constant text := 'America/Sao_Paulo';
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uap uuid := gen_random_uuid();
  pol uuid := gen_random_uuid();
  t timestamptz := (date_trunc('week', now() at time zone tz) + interval '15 days' + time '10:00') at time zone tz; -- terça 10h
  r public.reservas; r2 public.reservas; n int; msg text; h timestamptz;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (ua, zero, 'authenticated', 'authenticated', 't3-' || ua || '@teste.invalid'),
    (um, zero, 'authenticated', 'authenticated', 't3-' || um || '@teste.invalid'),
    (uap, zero, 'authenticated', 'authenticated', 't3-' || uap || '@teste.invalid');
  insert into public.empresas (id, nome) values (e, 'Teste Sprint 3');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'B');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo, odometro_km) values
    (c1, e, b, cat, 'TST0001', 'Rodado', 500), (c2, e, b, cat, 'TST0002', 'Novo', 100);
  insert into public.membros (empresa_id, user_id, perfil, nome) values
    (e, ua, 'admin', 'Adm'), (e, um, 'motorista', 'Mot'), (e, uap, 'aprovador', 'Apr');
  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade) values (e, um, '1', 'B', date '2035-01-01');
  insert into public.politicas (id, empresa_id, nome) values (pol, e, 'Uso');

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Política pendente bloqueia a reserva até o aceite
  select count(*) into n from public.politicas_pendentes(e);
  if n <> 1 then raise exception 'FALHOU 1: pendentes=%', n; end if;
  begin perform public.criar_reserva_por_categoria(cat, t, t + interval '2 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'politica_nao_aceita' then raise exception 'FALHOU 1b: %', msg; end if;
  insert into public.aceites_de_politica (empresa_id, politica_id, user_id) values (e, pol, um);
  select count(*) into n from public.politicas_pendentes(e);
  if n <> 0 then raise exception 'FALHOU 1c: ainda pendente'; end if;

  -- 2. Por categoria: menor odômetro primeiro, depois o seguinte, depois acaba
  r := public.criar_reserva_por_categoria(cat, t, t + interval '2 hours');
  if r.veiculo_id <> c2 then raise exception 'FALHOU 2: não escolheu o menos rodado'; end if;
  r2 := public.criar_reserva_por_categoria(cat, t, t + interval '2 hours');
  if r2.veiculo_id <> c1 then raise exception 'FALHOU 2b: não pegou o segundo carro'; end if;
  begin perform public.criar_reserva_por_categoria(cat, t, t + interval '2 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_veiculo_disponivel' then raise exception 'FALHOU 2c: %', msg; end if;

  -- 3. Horários alternativos: primeiro livre é depois do fim + intervalo técnico
  select count(*), min(s.inicio) into n, h from public.sugerir_horarios(t, t + interval '2 hours', cat) s;
  if n <> 3 then raise exception 'FALHOU 3: % sugestões', n; end if;
  if h <> t + interval '2 hours 30 minutes' then raise exception 'FALHOU 3b: primeira sugestão %', h; end if;

  -- 4. Fim de semana exige aprovação; recusa exige justificativa
  r := public.criar_reserva(c1, t + interval '4 days', t + interval '4 days 2 hours');
  if r.status <> 'solicitada' then raise exception 'FALHOU 4: sábado veio %', r.status; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uap, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.transicionar_reserva(r.id, 'recusada'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'justificativa_obrigatoria' then raise exception 'FALHOU 4b: %', msg; end if;
  r := public.transicionar_reserva(r.id, 'recusada', '{"justificativa":"sem necessidade"}');
  select count(*) into n from public.aprovacoes where reserva_id = r.id and decisao = 'recusada' and justificativa = 'sem necessidade';
  if n <> 1 then raise exception 'FALHOU 4c: recusa não registrada'; end if;
  reset role;

  -- 5. Cancelamento: com antecedência não marca; em cima da hora marca como tardio
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.transicionar_reserva(r2.id, 'cancelada');
  select count(*) into n from public.eventos_da_reserva
   where reserva_id = r2.id and para_status = 'cancelada' and detalhe ? 'cancelamento_tardio';
  if n <> 0 then raise exception 'FALHOU 5: cancelamento antecipado marcado como tardio'; end if;
  r := public.criar_reserva(c1, now() + interval '90 minutes', now() + interval '150 minutes');
  perform public.transicionar_reserva(r.id, 'cancelada');
  select count(*) into n from public.eventos_da_reserva
   where reserva_id = r.id and para_status = 'cancelada' and detalhe ->> 'cancelamento_tardio' = 'true';
  if n <> 1 then raise exception 'FALHOU 5b: cancelamento tardio não marcado'; end if;
  reset role;

  -- 6. A empresa não fica sem administrador ativo
  begin update public.membros set ativo = false where user_id = ua and empresa_id = e; msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'ultimo_admin' then raise exception 'FALHOU 6: %', msg; end if;
  begin update public.membros set perfil = 'motorista' where user_id = ua and empresa_id = e; msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'ultimo_admin' then raise exception 'FALHOU 6b: %', msg; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
