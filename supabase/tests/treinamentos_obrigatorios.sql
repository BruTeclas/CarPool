-- Testes da parte 3 dos treinamentos (obrigatoriedade, prazo, bloqueio, reciclagem). Desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); car uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); mot uuid := gen_random_uuid(); novo uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); t2 uuid; q uuid := gen_random_uuid(); r1 uuid := gen_random_uuid();
  j jsonb; n int; msg text; v_ciclo int;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 'to-' || u || '@teste.invalid' from unnest(array[adm, mot, novo]) u;
  insert into public.empresas (id, nome) values (e, 'Teste obrigatórios');
  update public.tipos_de_documento set obrigatorio = false where empresa_id = e; -- isola o teste da trava de documentos
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'Pátio');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values (car, e, b, cat, 'OBR0001', 'Um');
  insert into public.membros (empresa_id, user_id, perfil, nome, criado_em) values
    (e, adm, 'admin', 'Adm', now() - interval '60 days'), (e, mot, 'motorista', 'Mot', now() - interval '60 days'), (e, novo, 'motorista', 'Novo', now());

  -- treinamento obrigatório para motoristas: 15 dias de prazo, validade de 12 meses, bloqueia reservas e retiradas
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.treinamentos (id, empresa_id, titulo, publico_perfis, validade_meses, bloqueio, prazo_dias, criado_por)
  values (t, e, 'Direção segura', array['motorista']::public.perfil_membro[], 12, 'reservas_e_retiradas', 15, adm);
  insert into public.treinamento_etapas (treinamento_id, empresa_id, ordem, tipo, titulo, texto, tempo_minimo_seg) values (t, e, 1, 'texto', 'Leia', 'Regras.', 10);
  insert into public.treinamento_perguntas (id, treinamento_id, empresa_id, ordem, tipo, enunciado) values (q, t, e, 1, 'vf', 'Cinto é obrigatório.');
  insert into public.treinamento_alternativas (pergunta_id, empresa_id, ordem, texto, correta) values (q, e, 1, 'Verdadeiro', true), (q, e, 2, 'Falso', false);
  perform public.publicar_treinamento(t);
  reset role;

  -- 1. Dentro do prazo: avisado, não bloqueia
  if not exists (select 1 from public.notificacoes where user_id = mot and titulo = 'Treinamento obrigatório: Direção segura') then raise exception 'FALHOU 1: sem aviso'; end if;
  if exists (select 1 from public.notificacoes where user_id = adm and titulo like 'Treinamento obrigatório%') then raise exception 'FALHOU 1b: admin avisado (fora do público)'; end if;
  if (select bloqueando from app.treinamentos_obrigatorios(e, mot)) then raise exception 'FALHOU 1c: bloqueou dentro do prazo'; end if;
  begin insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim) values (gen_random_uuid(), e, car, mot, mot, now() + interval '2 days', now() + interval '2 days 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg like 'treinamento_pendente%' then raise exception 'FALHOU 1d: reserva barrada no prazo'; end if;

  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status)
  values (r1, e, car, mot, mot, now() + interval '3 days', now() + interval '3 days 1 hour', 'aprovada');

  -- 2. Prazo vencido: reserva barrada
  set local session_replication_role = replica;
  update public.treinamentos set publicado_em = now() - interval '20 days' where id = t;
  set local session_replication_role = origin;
  begin insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim) values (e, car, mot, mot, now() + interval '4 days', now() + interval '4 days 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'treinamento_pendente: Direção segura' then raise exception 'FALHOU 2: %', msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if jsonb_array_length(public.pendencias_para_reservar(e) -> 'treinamentos') <> 1 then raise exception 'FALHOU 2b: pendência'; end if;
  j := public.meus_treinamentos(e);
  if (j -> 0 ->> 'obrigatorio')::boolean is not true or (j -> 0 ->> 'bloqueando')::boolean is not true then raise exception 'FALHOU 2c: %', j; end if;
  reset role;
  -- o novo motorista (entrou hoje) ainda está no prazo dele
  if (select bloqueando from app.treinamentos_obrigatorios(e, novo)) then raise exception 'FALHOU 2d: novo bloqueado sem prazo'; end if;

  -- 3. Retirada barrada; com bloqueio só de reservas, a retirada passa
  begin update public.reservas set status = 'liberada' where id = r1; msg := null; exception when others then msg := sqlerrm; end;
  if msg not like 'treinamento_pendente%' then raise exception 'FALHOU 3: retirada liberada (%)', msg; end if;
  update public.treinamentos set bloqueio = 'reservas' where id = t;
  begin update public.reservas set status = 'liberada' where id = r1; msg := null; exception when others then msg := sqlerrm; end;
  if msg like 'treinamento_pendente%' then raise exception 'FALHOU 3b: retirada barrada só com bloqueio de reservas'; end if;
  update public.treinamentos set bloqueio = 'reservas_e_retiradas' where id = t;

  -- 4. Aprovado: libera
  insert into public.treinamento_matriculas (treinamento_id, user_id, empresa_id, conteudo_concluido_em, aprovado_em, nota, valido_ate)
  values (t, mot, e, now() - interval '1 hour', now(), 100, now() + interval '12 months');
  if (select bloqueando from app.treinamentos_obrigatorios(e, mot)) then raise exception 'FALHOU 4: aprovado e bloqueado'; end if;
  begin insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim) values (e, car, mot, mot, now() + interval '5 days', now() + interval '5 days 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg like 'treinamento_pendente%' then raise exception 'FALHOU 4b: reserva barrada após aprovação'; end if;

  -- 5. Nova versão: a aprovação vale para a família
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t2 := public.nova_versao_treinamento(t);
  perform public.publicar_treinamento(t2);
  select count(*) into n from public.acompanhamento_treinamento(t2);
  if n <> 2 then raise exception 'FALHOU 5: público do acompanhamento = %', n; end if;
  if (select situacao from public.acompanhamento_treinamento(t2) where user_id = mot) <> 'aprovado' then raise exception 'FALHOU 5b: aprovação da versão 1 não valeu'; end if;
  if (select situacao from public.acompanhamento_treinamento(t2) where user_id = novo) <> 'nao_iniciado' then raise exception 'FALHOU 5c: situação do novo'; end if;
  reset role;
  if (select bloqueando from app.treinamentos_obrigatorios(e, mot)) then raise exception 'FALHOU 5d: nova versão bloqueou quem já era aprovado'; end if;

  -- 6. Venceu: bloqueia na hora e o conteúdo é refeito
  update public.treinamento_matriculas set aprovado_em = now() - interval '13 months', conteudo_concluido_em = now() - interval '13 months 1 hour',
    valido_ate = now() - interval '1 day' where treinamento_id = t and user_id = mot;
  if not (select bloqueando from app.treinamentos_obrigatorios(e, mot) where treinamento_id = t2) then raise exception 'FALHOU 6: vencido não bloqueou'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (public.pendencias_para_reservar(e) -> 'treinamentos' -> 0 ->> 'vencido')::boolean is not true then raise exception 'FALHOU 6b: não marcou vencido'; end if;
  reset role;
  insert into public.treinamento_matriculas (treinamento_id, user_id, empresa_id, conteudo_concluido_em, aprovado_em, nota, valido_ate)
  values (t2, novo, e, now() - interval '400 days', now() - interval '13 months', 90, now() - interval '1 day');
  select (app.matricula(t2, novo)).ciclo into v_ciclo;
  if v_ciclo <> 2 or (select conteudo_concluido_em from public.treinamento_matriculas where treinamento_id = t2 and user_id = novo) is not null then
    raise exception 'FALHOU 6c: reciclagem não reabriu o conteúdo'; end if;

  -- 7. Certificado: o próprio ou o gestor; outro colaborador não
  update public.treinamento_matriculas set aprovado_em = now(), valido_ate = now() + interval '12 months' where treinamento_id = t and user_id = mot;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.certificado_treinamento(t);
  if j ->> 'nome' <> 'Mot' or j ->> 'treinamento' <> 'Direção segura' then raise exception 'FALHOU 7: %', j; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', novo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.certificado_treinamento(t, mot); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 7b: viu certificado alheio'; end if;
  begin perform public.acompanhamento_treinamento(t2); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 7c: colaborador viu acompanhamento'; end if;
  reset role;

  -- 8. Rotina diária roda
  j := app.rotina_treinamentos();
  if j ->> 'avisos' is null then raise exception 'FALHOU 8: rotina'; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
