-- Testes do Sprint 5 (exceções e rotinas). Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  c4 uuid := gen_random_uuid(); c5 uuid := gen_random_uuid();
  um uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); ug uuid := gen_random_uuid();
  r_sol uuid := gen_random_uuid(); r_ns uuid := gen_random_uuid(); r_ns2 uuid := gen_random_uuid(); r_ns3 uuid := gen_random_uuid();
  r_at uuid := gen_random_uuid(); r_next uuid := gen_random_uuid(); r_uso uuid := gen_random_uuid(); r_fut uuid := gen_random_uuid();
  rel public.realocacoes; res public.reservas; inc public.incidentes; j jsonb; n int; msg text; st text; t_cnh uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 't5-' || u || '@teste.invalid' from unnest(array[um, m2, ug]) u;
  insert into public.empresas (id, nome) values (e, 'Teste Sprint 5');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'Pátio');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo, odometro_km) values
    (c1, e, b, cat, 'TSC0001', 'Um', 100), (c2, e, b, cat, 'TSC0002', 'Dois', 200), (c3, e, b, cat, 'TSC0003', 'Três', 300),
    (c4, e, b, cat, 'TSC0004', 'Quatro', 400), (c5, e, b, cat, 'TSC0005', 'Cinco', 500);
  insert into public.membros (empresa_id, user_id, perfil, nome) values
    (e, um, 'motorista', 'Motorista Um'), (e, m2, 'motorista', 'Motorista Dois'), (e, ug, 'gestor_frota', 'Gestor');
  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade) values
    (e, um, '1', 'B', current_date + 365), (e, m2, '2', 'B', current_date + 365);
  insert into public.contatos_assistencia (empresa_id, veiculo_id, seguradora, telefone_assistencia) values
    (e, null, 'Seguradora Padrão', '0800 000 0001'), (e, c5, 'Seguradora do Cinco', '0800 000 0005');

  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status) values
    (r_sol,  e, c2, um, um, now() - interval '1 minute',  now() + interval '20 minutes', 'solicitada'),
    (r_ns,   e, c1, um, um, now() - interval '31 minutes', now() + interval '1 hour',    'aprovada'),
    (r_ns2,  e, c2, m2, m2, now() - interval '10 minutes', now() + interval '50 minutes', 'aprovada'),
    (r_ns3,  e, c4, um, um, now() - interval '40 minutes', now() - interval '35 minutes', 'liberada'),
    (r_at,   e, c3, um, um, now() - interval '3 hours',   now() - interval '16 minutes', 'em_uso'),
    (r_next, e, c3, m2, m2, now() + interval '60 minutes', now() + interval '2 hours',   'aprovada'),
    (r_uso,  e, c5, m2, m2, now() - interval '1 hour',    now() + interval '2 hours',    'em_uso'),
    (r_fut,  e, c5, m2, m2, now() + interval '5 hours',   now() + interval '6 hours',    'aprovada');

  perform app.rotina_minuto();

  -- 1. Solicitação que chegou ao horário sem aprovação expira, sem falta
  select status into st from public.reservas where id = r_sol;
  if st <> 'cancelada' then raise exception 'FALHOU 1: solicitação ficou %', st; end if;
  if not exists (select 1 from public.notificacoes where reserva_id = r_sol and tipo = 'expirada') then raise exception 'FALHOU 1b: sem aviso'; end if;
  if exists (select 1 from public.faltas where reserva_id = r_sol) then raise exception 'FALHOU 1c: expiração contou falta'; end if;

  -- 2. No-show só depois da tolerância (30 min): aprovada e liberada
  select status into st from public.reservas where id = r_ns;
  if st <> 'no_show' then raise exception 'FALHOU 2: aprovada após 31 min ficou %', st; end if;
  select status into st from public.reservas where id = r_ns3;
  if st <> 'no_show' then raise exception 'FALHOU 2b: liberada sem retirada ficou %', st; end if;
  select status into st from public.reservas where id = r_ns2;
  if st <> 'aprovada' then raise exception 'FALHOU 2c: dentro da tolerância virou %', st; end if;
  if not exists (select 1 from public.eventos_da_reserva where reserva_id = r_ns and para_status = 'no_show' and detalhe ->> 'automatico' = 'true') then
    raise exception 'FALHOU 2d: evento automático não registrado'; end if;

  -- 3. Atraso depois de fim + 15 min, com aviso ao motorista e à gestão
  select status into st from public.reservas where id = r_at;
  if st <> 'atrasada' then raise exception 'FALHOU 3: em uso atrasado ficou %', st; end if;
  if not exists (select 1 from public.notificacoes where reserva_id = r_at and user_id = um and tipo = 'atraso') then raise exception 'FALHOU 3b: motorista sem aviso'; end if;
  if not exists (select 1 from public.notificacoes where reserva_id = r_at and user_id = ug and tipo = 'atraso') then raise exception 'FALHOU 3c: gestor sem aviso'; end if;

  -- 4. Três faltas em 30 dias suspendem; reserva nova é recusada; gestor retira a suspensão
  select count(*) into n from public.faltas where user_id = um;
  if n <> 3 then raise exception 'FALHOU 4: % faltas', n; end if;
  if not exists (select 1 from public.suspensoes where user_id = um and levantada_em is null and fim > now() + interval '6 days') then
    raise exception 'FALHOU 4b: suspensão não criada'; end if;
  begin
    insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status)
    values (e, c1, um, um, now() + interval '1 day', now() + interval '1 day 1 hour', 'solicitada');
    msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null or msg not like 'usuario_suspenso:%' then raise exception 'FALHOU 4c: suspenso conseguiu reservar (%)', msg; end if;

  -- 5. Realocação por atraso: próxima reserva do carro atrasado recebe oferta do carro livre (c1)
  select * into rel from public.realocacoes where reserva_id = r_next;
  if rel.id is null or rel.status <> 'oferecida' or rel.veiculo_sugerido_id <> c1 or rel.motivo <> 'atraso' then
    raise exception 'FALHOU 5: oferta %', to_jsonb(rel); end if;
  if not exists (select 1 from public.notificacoes where reserva_id = r_next and user_id = m2 and tipo = 'realocacao') then
    raise exception 'FALHOU 5b: motorista seguinte sem aviso'; end if;

  -- 6. Rotina é idempotente
  select count(*) into n from public.notificacoes;
  perform app.rotina_minuto();
  if (select count(*) from public.notificacoes) <> n or (select count(*) from public.realocacoes where reserva_id = r_next) <> 1 then
    raise exception 'FALHOU 6: segunda execução repetiu avisos ou ofertas'; end if;

  -- 7. Como motorista: só vê os próprios avisos; aceita a troca; recusa de terceiros
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.notificacoes where user_id <> um) then raise exception 'FALHOU 7: viu aviso de outra pessoa'; end if;
  begin perform public.responder_realocacao(rel.id, true); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'realocacao_nao_encontrada' then raise exception 'FALHOU 7b: terceiro respondeu (%)', msg; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.responder_realocacao(rel.id, true);
  if res.veiculo_id <> c1 then raise exception 'FALHOU 7c: reserva não mudou de carro'; end if;
  begin perform public.responder_realocacao(rel.id, true); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'realocacao_encerrada' then raise exception 'FALHOU 7d: respondeu duas vezes (%)', msg; end if;
  if public.marcar_notificacoes_lidas() < 1 then raise exception 'FALHOU 7e: nada marcado como lido'; end if;

  -- 8. Ocorrência: fora do uso é recusada; em uso bloqueia o carro, avisa a gestão e devolve a assistência do carro
  begin perform public.registrar_ocorrencia(r_ns2, 'pane_mecanica'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'ocorrencia_fora_do_uso' then raise exception 'FALHOU 8: ocorrência fora do uso (%)', msg; end if;
  j := public.registrar_ocorrencia(r_uso, 'acidente_sem_vitima', 'Batida leve', -23.55, -46.63, 15, 'Av. Paulista, 1000',
                                   '[]'::jsonb, now() - interval '3 minutes');
  if j -> 'assistencia' ->> 'telefone_assistencia' <> '0800 000 0005' then raise exception 'FALHOU 8b: assistência %', j; end if;
  begin perform public.encerrar_ocorrencia((j ->> 'ocorrencia_id')::uuid, 'Oficina'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'ocorrencia_nao_encontrada' then raise exception 'FALHOU 8c: motorista encerrou (%)', msg; end if;
  reset role;

  select status into st from public.reservas where id = r_uso;
  if st <> 'ocorrencia' then raise exception 'FALHOU 8d: reserva ficou %', st; end if;
  select status::text into st from public.veiculos where id = c5;
  if st <> 'bloqueado' then raise exception 'FALHOU 8e: carro ficou %', st; end if;
  select * into inc from public.incidentes where id = (j ->> 'ocorrencia_id')::uuid;
  if inc.registrada_em > now() - interval '2 minutes' then raise exception 'FALHOU 8f: horário do aparelho ignorado'; end if;
  if not exists (select 1 from public.notificacoes where reserva_id = r_uso and user_id = ug and importante) then
    raise exception 'FALHOU 8g: gestão sem aviso'; end if;
  if not exists (select 1 from public.realocacoes where reserva_id = r_fut and motivo = 'ocorrencia') then
    raise exception 'FALHOU 8h: reserva futura do carro não foi realocada'; end if;

  -- 9. Gestor encerra com encerramento especial e retira a suspensão
  perform set_config('request.jwt.claims', json_build_object('sub', ug, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.encerrar_ocorrencia(inc.id, 'Oficina Central', 12345, 'Para-choque', 'manutencao');
  perform public.levantar_suspensao((select id from public.suspensoes where user_id = um), 'Faltas justificadas');
  reset role;
  select status into st from public.reservas where id = r_uso;
  if st <> 'encerrada' then raise exception 'FALHOU 9: reserva ficou %', st; end if;
  if not exists (select 1 from public.eventos_da_reserva where reserva_id = r_uso and para_status = 'encerrada'
                 and detalhe ->> 'encerramento_especial' = 'true' and detalhe ->> 'local_veiculo' = 'Oficina Central') then
    raise exception 'FALHOU 9b: encerramento especial sem registro'; end if;
  if (select status::text || odometro_km from public.veiculos where id = c5) <> 'manutencao12345' then raise exception 'FALHOU 9c: carro'; end if;
  insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status)
  values (e, c1, um, um, now() + interval '2 days', now() + interval '2 days 1 hour', 'solicitada');

  -- 10. Rotina diária avisa documento vencendo em 7 dias
  select id into t_cnh from public.tipos_de_documento where empresa_id = e and e_cnh;
  insert into public.documentos (empresa_id, tipo_id, user_id, validade, caminho, status)
  values (e, t_cnh, m2, (now() at time zone 'America/Sao_Paulo')::date + 7, e || '/' || m2 || '/cnh.jpg', 'aprovado');
  perform app.rotina_diaria();
  if not exists (select 1 from public.notificacoes where user_id = m2 and tipo = 'documento' and titulo = 'CNH vence em 7 dias') then
    raise exception 'FALHOU 10: sem aviso de vencimento'; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
