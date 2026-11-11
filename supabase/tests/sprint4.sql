-- Testes do Sprint 4 (chave, vistoria, avaria, bloqueio). Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  um uuid := gen_random_uuid(); ug uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid();
  k1 text; k2 text; j jsonb; n int; msg text; st text;
  pos5 constant text[] := array['frente','traseira','lateral_esquerda','lateral_direita','painel'];
  itens_ok jsonb; fotos jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 't4-' || u || '@teste.invalid' from unnest(array[um, ug, ux]) u;
  insert into public.empresas (id, nome) values (e, 'Teste Sprint 4'), (e2, 'Outra empresa');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'Pátio Central');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo, odometro_km) values
    (c1, e, b, cat, 'TST0001', 'Carro Um', 1000), (c2, e, b, cat, 'TST0002', 'Carro Dois', 2000);
  insert into public.membros (empresa_id, user_id, perfil, nome) values
    (e, um, 'motorista', 'Mot'), (e, ug, 'gestor_frota', 'Ges'), (e2, ux, 'admin', 'Fora');
  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade) values (e, um, '1', 'B', date '2035-01-01');
  select codigo into k1 from public.chaves where veiculo_id = c1;
  select codigo into k2 from public.chaves where veiculo_id = c2;
  if k1 is null or k2 is null or k1 ~ 'TST' then raise exception 'FALHOU 0: chave não criada ou não opaca'; end if;
  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status)
  values (r1, e, c1, um, um, now() - interval '5 minutes', now() + interval '2 hours', 'aprovada');
  select jsonb_agg(jsonb_build_object('item', item, 'ok', true)) into itens_ok from public.checklist_padrao();

  -- anônimo: só a ficha mínima
  set local role anon;
  j := public.ficha_veiculo(k1);
  if j ->> 'modelo' <> 'Carro Um' or j ? 'placa' then raise exception 'FALHOU 1: ficha %', j; end if;
  begin perform public.ler_chave(k1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 1b: anônimo leu a chave'; end if;
  reset role;

  -- outra empresa não reconhece a chave
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.ler_chave(k1) ->> 'resultado' <> 'chave_desconhecida' then raise exception 'FALHOU 2'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.ler_chave(k2);
  if j ->> 'resultado' <> 'chave_errada' or j ->> 'placa' <> 'TST0001' then raise exception 'FALHOU 3: %', j; end if;
  if public.ler_chave('nao-existe') ->> 'resultado' <> 'chave_desconhecida' then raise exception 'FALHOU 3b'; end if;
  j := public.ler_chave(k1);
  if j ->> 'resultado' <> 'chave_certa' then raise exception 'FALHOU 4: %', j; end if;
  select status into st from public.reservas where id = r1;
  if st <> 'liberada' then raise exception 'FALHOU 4b: status %', st; end if;

  -- vistoria sem fotos é recusada
  begin perform public.registrar_vistoria(r1, 'saida', 1000, 80, itens_ok, '[]'::jsonb); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'fotos_obrigatorias_faltando' then raise exception 'FALHOU 5: %', msg; end if;
  reset role;

  insert into storage.objects (bucket_id, name)
  select 'vistorias', e || '/' || r1 || '/saida-' || p || '.jpg' from unnest(pos5) p;
  select jsonb_agg(jsonb_build_object('posicao', p, 'caminho', e || '/' || r1 || '/saida-' || p || '.jpg',
    'sha256', repeat('a', 64), 'tirada_em', now())) into fotos from unnest(pos5) p;

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.registrar_vistoria(r1, 'saida', 900, 80, itens_ok, fotos); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'odometro_invalido' then raise exception 'FALHOU 6: %', msg; end if;
  j := public.registrar_vistoria(r1, 'saida', 1010, 80, itens_ok, fotos);
  if j ->> 'resultado' <> 'em_uso' then raise exception 'FALHOU 6b: %', j; end if;
  if public.ler_chave(k1) ->> 'resultado' <> 'devolucao' then raise exception 'FALHOU 7'; end if;
  -- chegada sem a foto da vaga
  begin perform public.registrar_vistoria(r1, 'chegada', 1100, 50, itens_ok, fotos); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'fotos_obrigatorias_faltando' then raise exception 'FALHOU 8: %', msg; end if;
  reset role;

  insert into storage.objects (bucket_id, name)
  select 'vistorias', e || '/' || r1 || '/chegada-' || p || '.jpg' from unnest(pos5 || array['vaga']) p;
  select jsonb_agg(jsonb_build_object('posicao', p, 'caminho', e || '/' || r1 || '/chegada-' || p || '.jpg',
    'sha256', repeat('b', 64), 'tirada_em', now())) into fotos from unnest(pos5 || array['vaga']) p;

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.registrar_vistoria(r1, 'chegada', 1100, 50,
    (select jsonb_agg(jsonb_build_object('item', item, 'ok', item <> 'Retrovisores')) from public.checklist_padrao()),
    fotos, null, '["Risco na porta direita"]'::jsonb);
  if j ->> 'resultado' <> 'devolvida' or (j ->> 'avarias')::int <> 2 or (j ->> 'km_rodados')::int <> 90 then
    raise exception 'FALHOU 9: %', j; end if;
  select count(*) into n from public.avarias where reserva_id = r1;  -- o próprio responsável enxerga
  if n <> 2 then raise exception 'FALHOU 9b: motorista vê % avarias', n; end if;
  begin perform public.transicionar_reserva(r1, 'encerrada'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 9c: motorista encerrou reserva com avaria'; end if;
  reset role;
  select count(*) into n from public.ocorrencias where reserva_id = r1 and tipo in ('combustivel_abaixo', 'chave_errada');
  if n <> 2 then raise exception 'FALHOU 9d: ocorrências=%', n; end if;
  select odometro_km into n from public.veiculos where id = c1;
  if n <> 1100 then raise exception 'FALHOU 9e: odômetro %', n; end if;

  -- gestor encerra
  perform set_config('request.jwt.claims', json_build_object('sub', ug, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.transicionar_reserva(r1, 'encerrada');
  update public.avarias set status = 'resolvida' where reserva_id = r1;
  reset role;

  -- item crítico reprovado na saída: bloqueia o carro, abre ordem e cancela a reserva
  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status)
  values (r2, e, c2, um, um, now() - interval '5 minutes', now() + interval '2 hours', 'aprovada');
  insert into storage.objects (bucket_id, name)
  select 'vistorias', e || '/' || r2 || '/saida-' || p || '.jpg' from unnest(pos5) p;
  select jsonb_agg(jsonb_build_object('posicao', p, 'caminho', e || '/' || r2 || '/saida-' || p || '.jpg',
    'sha256', repeat('c', 64), 'tirada_em', now())) into fotos from unnest(pos5) p;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.ler_chave(k2);
  j := public.registrar_vistoria(r2, 'saida', 2000, 70,
    (select jsonb_agg(jsonb_build_object('item', item, 'ok', item <> 'Freios', 'critico', false)) from public.checklist_padrao()), fotos);
  if j ->> 'resultado' <> 'veiculo_bloqueado' then raise exception 'FALHOU 10: %', j; end if;
  begin perform public.concluir_ordem((select id from public.ordens_de_servico limit 1)); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 10b: motorista concluiu ordem'; end if;
  reset role;
  if (select status from public.veiculos where id = c2) <> 'bloqueado'
     or (select status from public.reservas where id = r2) <> 'cancelada' then raise exception 'FALHOU 10c'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ug, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.concluir_ordem((select id from public.ordens_de_servico where veiculo_id = c2 and status = 'aberta'));
  reset role;
  if (select status from public.veiculos where id = c2) <> 'ativo' then raise exception 'FALHOU 10d: não desbloqueou'; end if;

  -- janela: cedo demais aguarda; depois da tolerância vira não retirada
  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status) values
    (r3, e, c1, um, um, now() + interval '3 hours', now() + interval '5 hours', 'aprovada'),
    (r4, e, c2, um, um, now() - interval '2 hours', now() + interval '1 hour', 'aprovada');
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.ler_chave(k1) ->> 'resultado' <> 'antes_da_janela' then raise exception 'FALHOU 11'; end if;
  if public.ler_chave(k2) ->> 'resultado' <> 'fora_da_janela' then raise exception 'FALHOU 11b'; end if;
  reset role;
  if (select status from public.reservas where id = r4) <> 'no_show' then raise exception 'FALHOU 11c'; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
