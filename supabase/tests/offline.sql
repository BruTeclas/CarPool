-- Testes do modo offline e do checklist configurável. Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); cat2 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  um uuid := gen_random_uuid(); r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
  k1 text; k2 text; k3 text; j jsonb; n int; d jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email) values (um, zero, 'authenticated', 'authenticated', 't9-' || um || '@teste.invalid');
  insert into public.empresas (id, nome) values (e, 'Teste offline');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'B');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch'), (cat2, e, 'Utilitário');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values
    (c1, e, b, cat, 'OFF0001', 'Um'), (c2, e, b, cat, 'OFF0002', 'Dois'), (c3, e, b, cat2, 'OFF0003', 'Três');
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e, um, 'motorista', 'Mot');
  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade) values (e, um, '1', 'B', date '2035-01-01');
  select codigo into k1 from public.chaves where veiculo_id = c1;
  select codigo into k2 from public.chaves where veiculo_id = c2;
  select codigo into k3 from public.chaves where veiculo_id = c3;
  -- r1 e r2 começaram há 50 min (a tolerância de 30 já passou); r3 começa daqui a 3 h
  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status) values
    (r1, e, c1, um, um, now() - interval '50 minutes', now() + interval '2 hours', 'aprovada'),
    (r2, e, c2, um, um, now() - interval '50 minutes', now() + interval '2 hours', 'aprovada'),
    (r3, e, c3, um, um, now() + interval '3 hours', now() + interval '5 hours', 'aprovada');
  insert into public.checklist_itens (empresa_id, categoria_id, item, critico, ordem) values
    (e, null, 'Geral A', true, 1), (e, cat2, 'Baú travado', true, 1), (e, cat2, 'Rampa', false, 2);

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Leitura feita sem sinal há 40 min (dentro da tolerância na hora) é aceita depois e fica marcada
  j := public.ler_chave(k1, now() - interval '40 minutes');
  if j ->> 'resultado' <> 'chave_certa' or (j ->> 'offline')::boolean is not true then raise exception 'FALHOU 1: %', j; end if;
  select detalhe into d from public.eventos_da_reserva where reserva_id = r1 and para_status = 'liberada';
  if (d ->> 'offline')::boolean is not true or d ->> 'lido_em' is null then raise exception 'FALHOU 1b: evento %', d; end if;
  -- 2. A mesma situação sem horário do aparelho: prazo vencido
  if public.ler_chave(k2) ->> 'resultado' <> 'fora_da_janela' then raise exception 'FALHOU 2'; end if;
  -- 3. Horário no futuro ou com mais de 48 h é ignorado (cai na regra normal)
  if public.ler_chave(k3, now() + interval '4 hours') ->> 'resultado' <> 'antes_da_janela' then raise exception 'FALHOU 3: futuro aceito'; end if;
  if public.ler_chave(k3, now() - interval '3 days') ->> 'resultado' <> 'antes_da_janela' then raise exception 'FALHOU 3b: antigo aceito'; end if;
  -- 4. Horário do aparelho fora da janela daquela reserva não libera
  if public.ler_chave(k3, now() - interval '10 minutes') ->> 'resultado' <> 'antes_da_janela' then raise exception 'FALHOU 4'; end if;

  -- 5. Pacote offline: só reservas ativas, com o resumo da chave (nunca o código) e o checklist certo
  j := public.minhas_reservas_offline();
  if jsonb_array_length(j) <> 2 then raise exception 'FALHOU 5: % reservas no pacote', jsonb_array_length(j); end if;
  if j::text like '%' || k1 || '%' or j::text like '%' || k3 || '%' then raise exception 'FALHOU 5b: código da chave no pacote'; end if;
  if (select x ->> 'chave_sha256' from jsonb_array_elements(j) x where x ->> 'placa' = 'OFF0001')
     <> encode(sha256(convert_to(k1, 'UTF8')), 'hex') then raise exception 'FALHOU 5c: resumo errado'; end if;
  -- 6. Checklist: categoria com lista própria usa a dela; as outras usam a geral da empresa
  select count(*) into n from public.checklist_da_reserva(r3);
  if n <> 2 then raise exception 'FALHOU 6: utilitário com % itens', n; end if;
  if (select string_agg(item, ',') from public.checklist_da_reserva(r1)) <> 'Geral A' then raise exception 'FALHOU 6b'; end if;
  reset role;

  -- 7. "Crítico" vem do servidor mesmo que o aparelho mande outra coisa
  insert into public.vistorias (id, empresa_id, reserva_id, veiculo_id, tipo, autor_id, odometro_km, combustivel_pct)
  values (r2, e, r3, c3, 'saida', um, 0, 50);
  insert into public.itens_de_vistoria (empresa_id, vistoria_id, item, critico, ok) values
    (e, r2, 'Baú travado', false, true), (e, r2, 'Rampa', true, true), (e, r2, 'Inventado', true, true);
  if (select string_agg(item, ',' order by item) from public.itens_de_vistoria where vistoria_id = r2 and critico) <> 'Baú travado' then
    raise exception 'FALHOU 7'; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
