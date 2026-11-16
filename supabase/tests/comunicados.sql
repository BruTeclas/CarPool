-- Testes dos comunicados (treinamentos e comunicados, parte 1). Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  tz constant text := 'America/Sao_Paulo';
  e uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); g uuid := gen_random_uuid();
  b uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); car uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); gb uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); fin uuid := gen_random_uuid();
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; v public.comunicados; j jsonb; n int; msg text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select x, zero, 'authenticated', 'authenticated', 'tc-' || x || '@teste.invalid' from unnest(array[adm, gb, m1, m2, fin]) x;
  insert into public.empresas (id, nome) values (e, 'Teste comunicados');
  insert into public.unidades (id, empresa_id, nome) values (u1, e, 'Filial 1'), (u2, e, 'Filial 2');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, u1, 'Pátio');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values (car, e, b, cat, 'COM0001', 'Um');
  insert into public.membros (empresa_id, user_id, perfil, nome) values
    (e, adm, 'admin', 'Adm'), (e, gb, 'gestor_base', 'Gestor Base'), (e, m1, 'motorista', 'Mot Um'), (e, m2, 'motorista', 'Mot Dois'), (e, fin, 'financeiro', 'Fin');
  insert into public.membro_unidades (empresa_id, user_id, unidade_id) values (e, gb, u1), (e, m1, u1), (e, m2, u2)
  on conflict do nothing;
  insert into public.grupos (id, empresa_id, nome) values (g, e, 'Comercial');
  insert into public.grupo_membros (grupo_id, user_id, empresa_id) values (g, m1, e);

  -- 1. Gestor de base: só para a própria filial
  perform set_config('request.jwt.claims', json_build_object('sub', gb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin insert into public.comunicados (empresa_id, titulo, texto, unidade_id, criado_por) values (e, 'x', 'y', u2, gb); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 1: gestor de base enviou para outra filial'; end if;
  begin insert into public.comunicados (empresa_id, titulo, texto, criado_por) values (e, 'x', 'y', gb); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 1b: gestor de base enviou para a empresa toda'; end if;
  insert into public.comunicados (empresa_id, titulo, texto, unidade_id, criado_por) values (e, 'Pátio interditado', 'Use a entrada B.', u1, gb) returning id into c4;
  reset role;

  -- 2. Informativo para todos: aparece uma vez
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.comunicados (empresa_id, titulo, texto, criado_por) values (e, 'Maio Amarelo', 'Atenção no trânsito.', adm) returning id into c1;
  insert into public.comunicados (empresa_id, titulo, texto, nivel, publico_perfis, publico_grupos, criado_por)
  values (e, 'Recall do freio', 'Leia antes de dirigir.', 'bloqueante', array['motorista']::public.perfil_membro[], array[g], adm) returning id into c2;
  insert into public.comunicados (empresa_id, titulo, texto, nivel, recorrencia, criado_por)
  values (e, 'Política nova', 'Confirme a leitura.', 'ciencia', 'ate_confirmar', adm) returning id into c3;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.comunicados_pendentes(e);
  if jsonb_array_length(j) <> 4 or j -> 0 ->> 'id' <> c2::text then raise exception 'FALHOU 2: pendentes de m1 %', j; end if;
  if j -> 0 ? 'publico_grupos' then raise exception 'FALHOU 2b: vazou o público'; end if;
  perform public.marcar_comunicado(c1);
  perform public.marcar_comunicado(c4);
  -- 3. Bloqueante trava a reserva até a ciência
  if jsonb_array_length(public.pendencias_para_reservar(e) -> 'comunicados') <> 1 then raise exception 'FALHOU 3: pendência não listada'; end if;
  reset role; -- a reserva entra pelo banco direto; o que importa é a trava (gatilho)
  begin insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim)
        values (e, car, m1, m1, now() + interval '1 day', now() + interval '1 day 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  set local role authenticated;
  if msg is distinct from 'comunicado_pendente' then raise exception 'FALHOU 3b: %', msg; end if;
  perform public.marcar_comunicado(c2, false);
  if not exists (select 1 from jsonb_array_elements(public.comunicados_pendentes(e)) x where x ->> 'id' = c2::text) then
    raise exception 'FALHOU 3c: bloqueante sumiu só com a visualização'; end if;
  perform public.marcar_comunicado(c2, true);
  reset role; -- a reserva entra pelo banco direto; o que importa é a trava (gatilho)
  begin insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim)
        values (e, car, m1, m1, now() + interval '1 day', now() + interval '1 day 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  set local role authenticated;
  if msg = 'comunicado_pendente' then raise exception 'FALHOU 3d: continuou bloqueado após a ciência'; end if;
  -- 4. "Até confirmar": ver não basta
  perform public.marcar_comunicado(c3);
  j := public.comunicados_pendentes(e);
  if jsonb_array_length(j) <> 1 or j -> 0 ->> 'id' <> c3::text then raise exception 'FALHOU 4: %', j; end if;
  perform public.marcar_comunicado(c3, true);
  if jsonb_array_length(public.comunicados_pendentes(e)) <> 0 then raise exception 'FALHOU 4b: ainda pendente'; end if;
  if jsonb_array_length(public.meus_comunicados(e)) <> 4 then raise exception 'FALHOU 4c: Avisos'; end if;
  begin perform public.acompanhamento_comunicado(c1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 4d: motorista viu acompanhamento'; end if;
  select count(*) into n from public.comunicados;
  if n <> 0 then raise exception 'FALHOU 4e: motorista lê a tabela'; end if;
  reset role;

  -- 5. Público: m2 (outra filial, fora do grupo) só recebe os gerais
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from jsonb_array_elements(public.comunicados_pendentes(e));
  if n <> 2 then raise exception 'FALHOU 5: m2 recebeu % (esperado 2)', n; end if;
  reset role;

  -- 6. Acompanhamento, imutabilidade e encerramento
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.acompanhamento_comunicado(c2);
  if n <> 1 then raise exception 'FALHOU 6: público do recall = %', n; end if;
  if not exists (select 1 from public.acompanhamento_comunicado(c1) a where a.user_id = m1 and a.visto_em is not null)
     or (select count(*) from public.acompanhamento_comunicado(c1)) <> 5 then raise exception 'FALHOU 6b: acompanhamento'; end if;
  begin update public.comunicados set titulo = 'outro' where id = c1; msg := null; exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 6c: texto enviado mudou'; end if;
  update public.comunicados set encerrado_em = now(), encerrado_por = adm where id = c1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from jsonb_array_elements(public.comunicados_pendentes(e)) x where x ->> 'id' = c1::text) then
    raise exception 'FALHOU 6d: encerrado continua no ar'; end if;
  reset role;

  -- 7. Recorrências
  v.inicio := '2026-05-04 10:00'::timestamp at time zone tz; v.recorrencia := 'semanal';
  if app.comunicado_ocorrencia(v, '2026-05-13 09:00'::timestamp at time zone tz) <> '2026-05-11' then raise exception 'FALHOU 7: semanal'; end if;
  if app.comunicado_ocorrencia(v, '2026-05-04 09:00'::timestamp at time zone tz) is not null then raise exception 'FALHOU 7b: antes do início'; end if;
  v.recorrencia := 'diaria'; v.fim := '2026-06-01 00:00'::timestamp at time zone tz;
  if app.comunicado_ocorrencia(v, '2026-05-20 15:00'::timestamp at time zone tz) <> '2026-05-20' then raise exception 'FALHOU 7c: diária'; end if;
  if app.comunicado_ocorrencia(v, '2026-06-02 15:00'::timestamp at time zone tz) is not null then raise exception 'FALHOU 7d: depois do fim'; end if;
  v.fim := null; v.recorrencia := 'mensal'; v.inicio := '2026-01-31 08:00'::timestamp at time zone tz;
  if app.comunicado_ocorrencia(v, '2026-03-15 08:00'::timestamp at time zone tz) <> '2026-02-28' then raise exception 'FALHOU 7e: mensal %', app.comunicado_ocorrencia(v, '2026-03-15 08:00'::timestamp at time zone tz); end if;
  v.recorrencia := 'anual'; v.inicio := '2026-05-01 08:00'::timestamp at time zone tz; v.janela_dias := 31;
  if app.comunicado_ocorrencia(v, '2027-05-20 08:00'::timestamp at time zone tz) <> '2027-05-01' then raise exception 'FALHOU 7f: anual'; end if;
  if app.comunicado_ocorrencia(v, '2027-06-05 08:00'::timestamp at time zone tz) is not null then raise exception 'FALHOU 7g: fora da janela anual'; end if;

  -- 8. Regras do cadastro
  begin insert into public.comunicados (empresa_id, titulo, texto, nivel, recorrencia, criado_por) values (e, 'x', 'y', 'informativo', 'ate_confirmar', adm); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 8: "até confirmar" informativo aceito'; end if;
  begin insert into public.comunicados (empresa_id, titulo, criado_por) values (e, 'x', adm); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 8b: comunicado vazio aceito'; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
