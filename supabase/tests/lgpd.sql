-- Testes do Sprint 7 (LGPD). Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); mot uuid := gen_random_uuid(); ex uuid := gen_random_uuid(); adm2 uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); vi uuid := gen_random_uuid(); av uuid; sol uuid; t_cnh uuid;
  j jsonb; n int; msg text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 't7-' || u || '@teste.invalid' from unnest(array[adm, mot, ex, adm2]) u;
  insert into public.empresas (id, nome) values (e, 'Teste LGPD');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'Pátio');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values (c1, e, b, cat, 'LGP0001', 'Um');
  insert into public.membros (empresa_id, user_id, perfil, nome) values
    (e, adm, 'admin', 'Adm'), (e, adm2, 'admin', 'Adm Dois'), (e, mot, 'motorista', 'Motorista Ativo'), (e, ex, 'motorista', 'Ex Colaborador');
  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade) values (e, mot, '1', 'B', current_date + 300), (e, ex, '2', 'B', current_date + 300);
  select id into t_cnh from public.tipos_de_documento where empresa_id = e and e_cnh;
  insert into public.documentos (empresa_id, tipo_id, user_id, validade, caminho, status, enviado_em) values
    (e, t_cnh, ex, current_date + 300, e || '/' || ex || '/cnh.jpg', 'aprovado', now()),
    (e, t_cnh, mot, current_date - 400, e || '/' || mot || '/cnh-antiga.jpg', 'aprovado', now() - interval '800 days'),
    (e, t_cnh, mot, current_date + 300, e || '/' || mot || '/cnh-nova.jpg', 'aprovado', now());
  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status) values
    (r1, e, c1, mot, mot, now() - interval '800 days', now() - interval '799 days', 'encerrada'),
    (r2, e, c1, ex, ex, now() + interval '1 day', now() + interval '1 day 2 hours', 'aprovada');
  insert into public.vistorias (id, empresa_id, reserva_id, veiculo_id, tipo, autor_id, odometro_km, combustivel_pct, criado_em)
  values (vi, e, r1, c1, 'saida', mot, 100, 80, now() - interval '800 days');
  insert into public.fotos (empresa_id, vistoria_id, posicao, caminho, sha256, tirada_em, latitude, longitude, criado_em) values
    (e, vi, 'frente', e || '/' || r1 || '/velha.jpg', repeat('a', 64), now() - interval '800 days', -23.5, -46.6, now() - interval '800 days');
  insert into public.notificacoes (empresa_id, user_id, tipo, titulo, criada_em, lida_em) values
    (e, mot, 'x', 'lida e velha', now() - interval '200 days', now() - interval '199 days'),
    (e, mot, 'x', 'nova', now(), null);
  insert into public.avisos_privacidade (empresa_id, versao, texto) values (e, 1, 'Tratamos seus dados para gerir a frota.') returning id into av;

  -- 1. Aviso pendente, ciência e texto que não muda
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.aviso_privacidade_pendente(e) ->> 'id' <> av::text then raise exception 'FALHOU 1: aviso não pendente'; end if;
  perform public.dar_ciencia_privacidade(av);
  if public.aviso_privacidade_pendente(e) is not null then raise exception 'FALHOU 1b: aviso continua pendente'; end if;
  begin update public.avisos_privacidade set texto = 'outro' where id = av; msg := null; exception when others then msg := sqlerrm; end;
  -- motorista nem enxerga para alterar (RLS): nenhuma linha afetada, texto intacto
  reset role;
  if (select texto from public.avisos_privacidade where id = av) <> 'Tratamos seus dados para gerir a frota.' then raise exception 'FALHOU 1c: texto alterado'; end if;
  begin update public.avisos_privacidade set texto = 'outro' where id = av; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'aviso_publicado_nao_muda' then raise exception 'FALHOU 1d: % ', msg; end if;

  -- 2. Titular: exporta, corrige o nome e pede exclusão; não exporta de outra empresa
  set local role authenticated;
  j := public.meus_dados(e);
  if j -> 'cnh' ->> 'numero' <> '1' or jsonb_array_length(j -> 'reservas') <> 1 or jsonb_array_length(j -> 'avisos_de_privacidade') <> 1 then
    raise exception 'FALHOU 2: exportação %', j; end if;
  if public.meus_dados(gen_random_uuid()) is not null then raise exception 'FALHOU 2b: exportou de outra empresa'; end if;
  perform public.atualizar_meu_nome(e, 'Motorista Nome Corrigido');
  sol := public.pedir_ao_controlador(e, 'eliminacao', 'Quero que apaguem meus dados.');
  reset role;
  if (select nome from public.membros where user_id = mot) <> 'Motorista Nome Corrigido' then raise exception 'FALHOU 2c: nome'; end if;
  if not exists (select 1 from public.notificacoes where user_id = adm and tipo = 'privacidade') then raise exception 'FALHOU 2d: admin não avisado'; end if;

  -- 3. Admin responde e anonimiza; reserva em andamento impede; não anonimiza a si mesmo
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.responder_solicitacao(sol, 'atendida', 'Dados excluídos conforme pedido.');
  begin perform public.anonimizar_pessoa(e, ex, 'saiu da empresa'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'pessoa_com_reserva_em_andamento' then raise exception 'FALHOU 3: %', msg; end if;
  begin perform public.anonimizar_pessoa(e, adm, 'teste'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'nao_pode_anonimizar_a_si_mesmo' then raise exception 'FALHOU 3b: %', msg; end if;
  reset role;
  update public.reservas set status = 'cancelada' where id = r2;
  set local role authenticated;
  perform public.anonimizar_pessoa(e, ex, 'saiu da empresa');
  reset role;
  if (select nome from public.membros where user_id = ex) <> 'Pessoa removida' then raise exception 'FALHOU 3c: nome não removido'; end if;
  if exists (select 1 from public.cnhs where user_id = ex) or exists (select 1 from public.documentos where user_id = ex) then raise exception 'FALHOU 3d: CNH ou documento ficou'; end if;
  if not exists (select 1 from public.arquivos_a_apagar where caminho = e || '/' || ex || '/cnh.jpg') then raise exception 'FALHOU 3e: arquivo não foi para a fila'; end if;
  if (select email from auth.users where id = ex) not like 'removido-%@anonimo.invalid' then raise exception 'FALHOU 3f: conta não anonimizada'; end if;
  if not exists (select 1 from public.reservas where id = r2) then raise exception 'FALHOU 3g: histórico apagado'; end if;

  -- 4. Rotina de retenção
  update public.membros set ativo = false where user_id = adm; -- vira ex-colaborador (adm2 segue como admin)...
  update public.membros set inativado_em = now() - interval '400 days' where user_id = adm; -- ...há mais de 365 dias
  perform app.rotina_lgpd();
  if exists (select 1 from public.fotos where vistoria_id = vi) then raise exception 'FALHOU 4: foto de 800 dias ficou'; end if;
  if not exists (select 1 from public.arquivos_a_apagar where caminho = e || '/' || r1 || '/velha.jpg') then raise exception 'FALHOU 4b: foto não foi para a fila'; end if;
  if exists (select 1 from public.documentos where caminho like '%cnh-antiga.jpg') then raise exception 'FALHOU 4c: documento substituído ficou'; end if;
  if not exists (select 1 from public.documentos where caminho like '%cnh-nova.jpg') then raise exception 'FALHOU 4d: documento em vigor apagado'; end if;
  if exists (select 1 from public.notificacoes where titulo = 'lida e velha') or not exists (select 1 from public.notificacoes where titulo = 'nova') then
    raise exception 'FALHOU 4e: avisos'; end if;
  if (select nome from public.membros where user_id = adm limit 1) <> 'Pessoa removida' then raise exception 'FALHOU 4f: ex-colaborador antigo não anonimizado'; end if;
  if (select nome from public.membros where user_id = mot) = 'Pessoa removida' then raise exception 'FALHOU 4g: anonimizou quem está ativo'; end if;

  delete from public.arquivos_a_apagar where caminho like e || '/%';
  raise exception 'OK_TESTES_PASSARAM';
end $$;
