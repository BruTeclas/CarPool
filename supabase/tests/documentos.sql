-- Testes de documentos e termos. Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  tz constant text := 'America/Sao_Paulo';
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); uni uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); mot uuid := gen_random_uuid();
  t_cnh uuid; t_dd uuid := gen_random_uuid(); t_crlv uuid := gen_random_uuid(); termo uuid := gen_random_uuid();
  t timestamptz := (date_trunc('week', now() at time zone tz) + interval '15 days' + time '10:00') at time zone tz;
  d public.documentos; a public.assinaturas_de_termo; j jsonb; n int; msg text;
  pm text; pc text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 'td-' || u || '@teste.invalid' from unnest(array[adm, mot]) u;
  insert into public.empresas (id, nome) values (e, 'Teste documentos');
  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'U');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'B');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values (c1, e, b, cat, 'DOC0001', 'Um');
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e, adm, 'admin', 'Adm'), (e, mot, 'motorista', 'Mot');
  pm := e || '/' || mot || '/'; pc := e || '/' || c1 || '/';
  insert into storage.objects (bucket_id, name) values
    ('documentos', pm || 'cnh.jpg'), ('documentos', pm || 'dd.pdf'), ('documentos', pm || 'dd2.pdf'),
    ('documentos', pm || 'assinatura.png'), ('documentos', pc || 'crlv.pdf'), ('documentos', e || '/' || adm || '/x.jpg');

  -- 1. Toda empresa nasce com o tipo CNH
  select id into t_cnh from public.tipos_de_documento where empresa_id = e and e_cnh;
  if t_cnh is null then raise exception 'FALHOU 1: tipo CNH não criado'; end if;
  insert into public.tipos_de_documento (id, empresa_id, nome, alvo) values
    (t_dd, e, 'Direção defensiva', 'condutor'), (t_crlv, e, 'CRLV', 'veiculo');

  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- 2. CNH enviada pelo condutor fica pendente e ainda não vale
  d := public.enviar_documento(t_cnh, pm || 'cnh.jpg', 'cnh.jpg', date '2031-06-30', '0451239876', 'AB');
  if d.status <> 'pendente' then raise exception 'FALHOU 2: status %', d.status; end if;
  if exists (select 1 from public.cnhs where user_id = mot) then raise exception 'FALHOU 2b: CNH valeu antes da conferência'; end if;
  if (public.pendencias_para_reservar(e) ->> 'cnh')::boolean is not true then raise exception 'FALHOU 2c'; end if;
  -- 3. Condutor não confere, não usa arquivo de outra pessoa, não manda documento vencido nem de veículo
  begin perform public.conferir_documento(d.id, true); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 3: %', msg; end if;
  begin perform public.enviar_documento(t_dd, e || '/' || adm || '/x.jpg', 'x', date '2031-01-01'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'arquivo_nao_encontrado' then raise exception 'FALHOU 3b: %', msg; end if;
  begin perform public.enviar_documento(t_dd, pm || 'dd.pdf', 'dd', current_date - 1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'documento_vencido' then raise exception 'FALHOU 3c: %', msg; end if;
  begin perform public.enviar_documento(t_dd, pm || 'dd.pdf', 'dd', null); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'validade_obrigatoria' then raise exception 'FALHOU 3d: %', msg; end if;
  begin perform public.enviar_documento(t_crlv, pc || 'crlv.pdf', 'crlv', date '2031-01-01', null, null, null, c1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 3e: %', msg; end if;
  reset role;

  -- 4. Gestão: recusar exige motivo; aprovar a CNH atualiza o cadastro usado nas reservas
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.conferir_documento(d.id, false); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'motivo_obrigatorio' then raise exception 'FALHOU 4: %', msg; end if;
  perform public.conferir_documento(d.id, true);
  reset role;
  if (select validade from public.cnhs where user_id = mot and categoria = 'AB') is distinct from date '2031-06-30' then
    raise exception 'FALHOU 4b: CNH não aplicada'; end if;

  -- 5. Sem documento obrigatório do condutor não reserva
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.criar_reserva(c1, t, t + interval '2 hours'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'documento_pendente: Direção defensiva' then raise exception 'FALHOU 5: %', msg; end if;
  d := public.enviar_documento(t_dd, pm || 'dd.pdf', 'dd.pdf', date '2031-01-01');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.conferir_documento(d.id, true);
  reset role;
  -- 5b. Veículo sem documento obrigatório não aparece nem aceita reserva
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.disponibilidade(t, t + interval '2 hours')) <> 0 then raise exception 'FALHOU 5b: veículo sem CRLV disponível'; end if;
  begin perform public.criar_reserva(c1, t, t + interval '2 hours'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'veiculo_sem_documento: CRLV' then raise exception 'FALHOU 5c: %', msg; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  d := public.enviar_documento(t_crlv, pc || 'crlv.pdf', 'crlv.pdf', current_date + 10, null, null, null, c1);
  if d.status <> 'aprovado' then raise exception 'FALHOU 5d: documento da gestão não nasceu aprovado'; end if;
  -- 6. Termo de uso: publicado pelo administrador, imutável
  insert into public.termos (id, empresa_id, titulo, texto, versao) values (termo, e, 'Termo de uso da frota', 'Eu me comprometo a zelar pelo veículo.', 1);
  begin update public.termos set texto = 'outro' where id = termo; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'termo_imutavel' then raise exception 'FALHOU 6: %', msg; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- CRLV vence em 10 dias: reserva daqui a 15 dias não pode usar o carro
  if (select count(*) from public.disponibilidade(t, t + interval '2 hours')) <> 0 then raise exception 'FALHOU 6b: CRLV vencido na data da reserva'; end if;
  reset role;
  update public.documentos set validade = date '2031-01-01' where id = d.id;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.disponibilidade(t, t + interval '2 hours')) <> 1 then raise exception 'FALHOU 6c'; end if;
  begin perform public.criar_reserva(c1, t, t + interval '2 hours'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'termo_nao_assinado' then raise exception 'FALHOU 6d: %', msg; end if;
  j := public.pendencias_para_reservar(e);
  if jsonb_array_length(j -> 'termos') <> 1 or (j ->> 'cnh')::boolean then raise exception 'FALHOU 6e: %', j; end if;
  begin perform public.assinar_termo(termo, 'Mot', e || '/' || adm || '/x.jpg', repeat('a', 64)); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'arquivo_nao_encontrado' then raise exception 'FALHOU 6f: %', msg; end if;
  a := public.assinar_termo(termo, 'Motorista de Teste', pm || 'assinatura.png', repeat('a', 64));
  if a.texto_sha256 <> encode(sha256(convert_to('Eu me comprometo a zelar pelo veículo.', 'UTF8')), 'hex') then raise exception 'FALHOU 6g: resumo do texto'; end if;
  begin perform public.assinar_termo(termo, 'Motorista de Teste', pm || 'assinatura.png', repeat('a', 64)); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'termo_ja_assinado' then raise exception 'FALHOU 6h: %', msg; end if;
  -- 7. Com tudo em dia, reserva
  perform public.criar_reserva(c1, t, t + interval '2 hours');
  -- 8. Documento mais novo substitui o anterior: se vence antes da reserva, bloqueia
  d := public.enviar_documento(t_dd, pm || 'dd2.pdf', 'dd2.pdf', current_date + 5);
  reset role;
  begin update public.assinaturas_de_termo set nome_assinante = 'x' where id = a.id; msg := null; exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 8: assinatura alterada'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.conferir_documento(d.id, true);
  select count(*) into n from public.documentos_vencendo(e) where tipo = 'Direção defensiva' and dias = 5;
  if n <> 1 then raise exception 'FALHOU 8b: aviso de vencimento do gestor'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.documentos_vencendo(e, true)) <> 1 then raise exception 'FALHOU 8c: aviso do condutor'; end if;
  begin perform public.criar_reserva(c1, t + interval '1 day', t + interval '1 day 2 hours'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'documento_pendente: Direção defensiva' then raise exception 'FALHOU 8d: %', msg; end if;
  reset role;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
