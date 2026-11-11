-- Testes de acesso por filial e por empresa. Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  tz constant text := 'America/Sao_Paulo';
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); e2 uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m0 uuid := gen_random_uuid();
  gb2 uuid := gen_random_uuid(); fora uuid := gen_random_uuid(); novo uuid := gen_random_uuid();
  t timestamptz := (date_trunc('week', now() at time zone tz) + interval '15 days' + time '10:00') at time zone tz;
  r public.reservas; n int; msg text; k1 text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 'tf-' || u || '@teste.invalid'
  from unnest(array[adm, m1, m0, gb2, fora, novo]) u;
  insert into public.empresas (id, nome) values (e, 'Empresa com filiais'), (e2, 'Empresa de uma filial só');
  insert into public.unidades (id, empresa_id, nome) values (u1, e, 'Filial Norte'), (u2, e, 'Filial Sul'), (ux, e2, 'Sede');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b1, e, u1, 'Pátio Norte'), (b2, e, u2, 'Pátio Sul');
  insert into public.vagas (empresa_id, base_id, codigo) values (e, b1, 'N1'), (e, b2, 'S1');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo, odometro_km) values
    (c1, e, b1, cat, 'NOR0001', 'Carro Norte', 10), (c2, e, b2, cat, 'SUL0001', 'Carro Sul', 10);
  insert into public.membros (empresa_id, user_id, perfil, nome) values
    (e, adm, 'admin', 'Adm'), (e, m1, 'motorista', 'Mot Norte'), (e, m0, 'motorista', 'Mot sem filial'),
    (e, gb2, 'gestor_base', 'Portaria Sul'), (e2, fora, 'admin', 'Outra empresa');
  insert into public.membro_unidades (empresa_id, user_id, unidade_id) values (e, m1, u1), (e, gb2, u2);
  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade) values (e, m1, '1', 'B', date '2035-01-01');
  select codigo into k1 from public.chaves where veiculo_id = c1;

  -- 1. Empresa com mais de uma filial: ninguém ganha acesso automático
  select count(*) into n from public.membro_unidades where user_id = m0;
  if n <> 0 then raise exception 'FALHOU 1: acesso automático indevido'; end if;
  -- 1b. Empresa de uma filial só: quem entra já recebe a filial
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e2, novo, 'motorista', 'Novo');
  select count(*) into n from public.membro_unidades where user_id = novo and unidade_id = ux;
  if n <> 1 then raise exception 'FALHOU 1b: filial única não liberada'; end if;

  -- 2. Motorista da Filial Norte só enxerga o que é da Norte
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.unidades) <> 1 or (select count(*) from public.bases) <> 1
     or (select count(*) from public.vagas) <> 1 then raise exception 'FALHOU 2: vê filiais, bases ou vagas demais'; end if;
  if (select string_agg(placa, ',') from public.veiculos) is distinct from 'NOR0001' then
    raise exception 'FALHOU 2b: veículos visíveis = %', (select string_agg(placa, ',') from public.veiculos); end if;
  select count(*) into n from public.disponibilidade(t, t + interval '2 hours');
  if n <> 1 then raise exception 'FALHOU 2c: disponibilidade mostra % carros', n; end if;
  begin perform public.criar_reserva(c2, t, t + interval '2 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'veiculo_fora_da_sua_filial' then raise exception 'FALHOU 2d: %', msg; end if;
  r := public.criar_reserva(c1, t, t + interval '2 hours');
  begin insert into public.membro_unidades (empresa_id, user_id, unidade_id) values (e, m1, u2); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 2e: motorista liberou filial para si mesmo'; end if;
  reset role;

  -- 3. Sem filial liberada: não vê carro nenhum, e a chave é desconhecida
  perform set_config('request.jwt.claims', json_build_object('sub', m0, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.veiculos) <> 0 or (select count(*) from public.unidades) <> 0 then
    raise exception 'FALHOU 3: sem filial e vê dados'; end if;
  if (select count(*) from public.disponibilidade(t, t + interval '2 hours')) <> 0 then raise exception 'FALHOU 3b'; end if;
  if public.ler_chave(k1) ->> 'resultado' <> 'chave_desconhecida' then raise exception 'FALHOU 3c'; end if;
  reset role;

  -- 4. Portaria da Filial Sul não vê nem mexe na reserva da Norte
  perform set_config('request.jwt.claims', json_build_object('sub', gb2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.reservas) <> 0 then raise exception 'FALHOU 4: portaria Sul vê reserva da Norte'; end if;
  if (select string_agg(v.placa, ',') from public.chaves c join public.veiculos v on v.id = c.veiculo_id) is distinct from 'SUL0001' then
    raise exception 'FALHOU 4b: chaves visíveis erradas'; end if;
  begin perform public.transicionar_reserva(r.id, 'liberada'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'reserva_nao_encontrada' then raise exception 'FALHOU 4c: %', msg; end if;
  reset role;

  -- 5. Administrador vê todas as filiais, mas não reserva para quem não tem acesso à filial
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.veiculos) <> 2 or (select count(*) from public.unidades) <> 2
     or (select count(*) from public.reservas) <> 1 then raise exception 'FALHOU 5: admin não vê tudo'; end if;
  begin perform public.criar_reserva(c2, t, t + interval '2 hours', null, null, 0, m1); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'motorista_sem_acesso_a_filial' then raise exception 'FALHOU 5b: %', msg; end if;
  -- libera a Norte para a portaria: agora ela vê e entrega
  insert into public.membro_unidades (empresa_id, user_id, unidade_id) values (e, gb2, u1);
  -- e não consegue liberar filial de outra empresa
  begin insert into public.membro_unidades (empresa_id, user_id, unidade_id) values (e, m1, ux); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 5c: liberou filial de outra empresa'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', gb2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.reservas) <> 1 then raise exception 'FALHOU 6: portaria não vê após liberar'; end if;
  r := public.transicionar_reserva(r.id, 'liberada');
  if r.status <> 'liberada' then raise exception 'FALHOU 6b'; end if;
  reset role;

  -- 7. Outra empresa não vê absolutamente nada desta
  perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.veiculos where empresa_id = e) or exists (select 1 from public.unidades where empresa_id = e)
     or exists (select 1 from public.reservas where empresa_id = e) or exists (select 1 from public.membros where empresa_id = e)
     or exists (select 1 from public.membro_unidades where empresa_id = e) then
    raise exception 'FALHOU 7: vazamento entre empresas'; end if;
  if public.ler_chave(k1) ->> 'resultado' <> 'chave_desconhecida' then raise exception 'FALHOU 7b'; end if;
  reset role;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
