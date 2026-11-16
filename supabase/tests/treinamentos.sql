-- Testes dos treinamentos (parte 2). Autossuficiente; desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
-- O tempo passa "de mentira": entre um sinal e outro, o teste recua o horário do último sinal.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  e uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); mot uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t1v2 uuid;
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid();
  q1 uuid := gen_random_uuid(); q2 uuid := gen_random_uuid(); q3 uuid := gen_random_uuid(); q4 uuid := gen_random_uuid(); q5 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); j jsonb; x jsonb; n int; msg text; tent uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 'tt-' || u || '@teste.invalid' from unnest(array[adm, mot]) u;
  insert into public.empresas (id, nome) values (e, 'Teste treinamentos');
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e, adm, 'admin', 'Adm'), (e, mot, 'motorista', 'Mot');

  -- 1. Gestor monta o rascunho; publicar confere a prova; publicado congela
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.treinamentos (id, empresa_id, titulo, tentativas, criado_por) values (t1, e, 'Direção defensiva', 2, adm);
  insert into public.treinamento_etapas (id, treinamento_id, empresa_id, ordem, tipo, titulo, youtube_id, duracao_seg, tempo_minimo_seg) values
    (e1, t1, e, 1, 'youtube', 'Vídeo', 'dQw4w9WgXcQ', 20, 20);
  insert into public.treinamento_etapas (id, treinamento_id, empresa_id, ordem, tipo, titulo, texto, tempo_minimo_seg) values
    (e2, t1, e, 2, 'texto', 'Leitura', 'Mantenha distância do carro da frente.', 10);
  insert into public.treinamento_perguntas (id, treinamento_id, empresa_id, ordem, tipo, enunciado) values
    (q1, t1, e, 1, 'unica', 'Distância segura?'), (q2, t1, e, 2, 'multipla', 'O que conferir?'), (q3, t1, e, 3, 'vf', 'Celular ao volante é permitido.');
  insert into public.treinamento_alternativas (id, pergunta_id, empresa_id, ordem, texto, correta) values
    (a1, q1, e, 1, '2 segundos', true), (a2, q1, e, 2, 'meio segundo', false),
    (b1, q2, e, 1, 'Pneus', true), (b2, q2, e, 2, 'Freios', true), (b3, q2, e, 3, 'Cor do carro', false),
    (v1, q3, e, 1, 'Verdadeiro', false), (v2, q3, e, 2, 'Falso', false);
  begin perform public.publicar_treinamento(t1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'pergunta_sem_gabarito' then raise exception 'FALHOU 1: publicou sem gabarito (%)', msg; end if;
  update public.treinamento_alternativas set correta = true where id = v2;
  perform public.publicar_treinamento(t1);
  begin update public.treinamento_etapas set tempo_minimo_seg = 10 where id = e1; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'treinamento_publicado_nao_muda' then raise exception 'FALHOU 1b: etapa publicada mudou (%)', msg; end if;
  begin update public.treinamentos set nota_minima = 10 where id = t1; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'treinamento_publicado_nao_muda' then raise exception 'FALHOU 1c: nota mínima mudou (%)', msg; end if;
  begin delete from public.treinamentos where id = t1; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'treinamento_publicado_nao_muda' then raise exception 'FALHOU 1d: publicado apagado (%)', msg; end if;
  -- t2: uma etapa de texto e uma prova com resposta escrita; validade de 12 meses
  insert into public.treinamentos (id, empresa_id, titulo, validade_meses, criado_por) values (t2, e, 'Reciclagem', 12, adm);
  insert into public.treinamento_etapas (id, treinamento_id, empresa_id, ordem, tipo, titulo, texto, tempo_minimo_seg) values
    (e3, t2, e, 1, 'texto', 'Regras', 'Leia as regras.', 10);
  insert into public.treinamento_perguntas (id, treinamento_id, empresa_id, ordem, tipo, enunciado) values
    (q4, t2, e, 1, 'unica', 'Pode fumar no carro?'), (q5, t2, e, 2, 'escrita', 'Explique a vistoria.');
  insert into public.treinamento_alternativas (id, pergunta_id, empresa_id, ordem, texto, correta) values
    (c1, q4, e, 1, 'Não', true), (c2, q4, e, 2, 'Sim', false);
  perform public.publicar_treinamento(t2);
  reset role;

  -- 2. Colaborador: vê os treinamentos, nunca o gabarito, e segue a ordem das etapas
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if jsonb_array_length(public.meus_treinamentos(e)) <> 2 then raise exception 'FALHOU 2: lista'; end if;
  select count(*) into n from public.treinamento_alternativas;
  if n <> 0 then raise exception 'FALHOU 2b: colaborador lê o gabarito'; end if;
  begin insert into public.treinamentos (empresa_id, titulo) values (e, 'x'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 2c: colaborador criou treinamento'; end if;
  begin perform public.sinal_etapa(e2, s, 0, true); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'etapa_bloqueada' then raise exception 'FALHOU 2d: pulou etapa (%)', msg; end if;
  begin perform public.iniciar_prova(t1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'conteudo_pendente' then raise exception 'FALHOU 2e: prova antes do conteúdo (%)', msg; end if;

  -- 3. Telemetria do vídeo
  j := public.sinal_etapa(e1, s, 0, true);
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 5, true);
  if (j ->> 'pendentes')::numeric <> 5 then raise exception 'FALHOU 3: 5 s assistidos viraram %', j ->> 'pendentes'; end if;
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 19, true);   -- adiantou o vídeo
  if (j ->> 'posicao_permitida')::numeric <> 5 or (j ->> 'pendentes')::numeric <> 5 then raise exception 'FALHOU 3b: adiantar não foi barrado %', j; end if;
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 15, true);   -- 10 s de vídeo em 5 s de relógio (velocidade 2x)
  if (j ->> 'posicao_permitida') is null then raise exception 'FALHOU 3c: velocidade 2x aceita %', j; end if;
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 10, false);  -- pausado: não conta
  if (j ->> 'pendentes')::numeric <> 5 then raise exception 'FALHOU 3d: pausado contou %', j; end if;
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 10, true);   -- voltou a tocar; posição 10 já marcada na pausa, nada novo
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 15, true);
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds' where etapa_id = e1; set local role authenticated;
  j := public.sinal_etapa(e1, s, 20, true);
  if (j ->> 'pronta')::boolean is not true or (j ->> 'concluida')::boolean then raise exception 'FALHOU 3e: %', j; end if;
  -- sem confirmar presença não conclui; a próxima etapa continua travada
  begin perform public.sinal_etapa(e2, s, 0, true); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'etapa_bloqueada' then raise exception 'FALHOU 3f: concluiu sem presença'; end if;
  j := public.confirmar_presenca(e1);
  if (j ->> 'concluida')::boolean is not true then raise exception 'FALHOU 3g: não concluiu %', j; end if;

  -- 4. Texto: presença vencida descarta o trecho; precisa chegar ao fim
  j := public.sinal_etapa(e2, s, 0, true);
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '5 seconds', presenca_em = now() - interval '7 minutes' where etapa_id = e2; set local role authenticated;
  j := public.sinal_etapa(e2, s, 0, true);
  if (j ->> 'pendentes')::numeric <> 0 then raise exception 'FALHOU 4: contou sem presença %', j; end if;
  j := public.confirmar_presenca(e2);
  if (j ->> 'segundos')::numeric <> 0 then raise exception 'FALHOU 4b: %', j; end if;
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '6 seconds' where etapa_id = e2; set local role authenticated;
  j := public.sinal_etapa(e2, s, 0, true);
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '6 seconds' where etapa_id = e2; set local role authenticated;
  j := public.sinal_etapa(e2, s, 0, true);
  j := public.confirmar_presenca(e2);
  if (j ->> 'concluida')::boolean then raise exception 'FALHOU 4c: concluiu sem ler até o fim'; end if;
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '1 seconds' where etapa_id = e2; set local role authenticated;
  j := public.sinal_etapa(e2, s, 0, true, true);
  j := public.confirmar_presenca(e2);
  if (j ->> 'concluida')::boolean is not true then raise exception 'FALHOU 4d: %', j; end if;
  if (public.conteudo_treinamento(t1) -> 'matricula' ->> 'conteudo_concluido_em') is null then raise exception 'FALHOU 4e: conteúdo não concluído'; end if;

  -- 5. Prova sem gabarito à vista; duas reprovações voltam o conteúdo
  x := public.iniciar_prova(t1);
  if x::text like '%correta%' then raise exception 'FALHOU 5: gabarito na prova'; end if;
  if jsonb_array_length(x -> 'perguntas') <> 3 then raise exception 'FALHOU 5b: perguntas'; end if;
  if (public.iniciar_prova(t1) ->> 'id') <> (x ->> 'id') then raise exception 'FALHOU 5c: abriu outra tentativa'; end if;
  j := public.enviar_prova((x ->> 'id')::uuid, jsonb_build_object(q1, jsonb_build_array(a1), q2, jsonb_build_array(b1), q3, jsonb_build_array(v2)));
  if j ->> 'status' <> 'reprovada' or (j ->> 'nota')::numeric <> 66.67 then raise exception 'FALHOU 5d: várias certas pela metade valeu %', j; end if;
  x := public.iniciar_prova(t1);
  j := public.enviar_prova((x ->> 'id')::uuid, '{}'::jsonb);
  if j ->> 'status' <> 'reprovada' then raise exception 'FALHOU 5e: %', j; end if;
  begin perform public.iniciar_prova(t1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'conteudo_pendente' then raise exception 'FALHOU 5f: sem refazer o conteúdo (%)', msg; end if;
  if (public.conteudo_treinamento(t1) -> 'matricula' ->> 'ciclo')::int <> 2 then raise exception 'FALHOU 5g: ciclo'; end if;

  -- 6. Resposta escrita: aguarda o gestor; aprovação com validade
  j := public.sinal_etapa(e3, s, 0, true);
  reset role; update public.treinamento_progresso set ultimo_sinal_em = ultimo_sinal_em - interval '10 seconds' where etapa_id = e3; set local role authenticated;
  j := public.sinal_etapa(e3, s, 0, true, true);
  j := public.confirmar_presenca(e3);
  x := public.iniciar_prova(t2);
  j := public.enviar_prova((x ->> 'id')::uuid, jsonb_build_object(q4, jsonb_build_array(c1), q5, 'Confiro pneus, luzes e lataria.'));
  if j ->> 'status' <> 'aguardando_correcao' then raise exception 'FALHOU 6: %', j; end if;
  begin perform public.iniciar_prova(t2); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'prova_em_correcao' then raise exception 'FALHOU 6b: (%)', msg; end if;
  begin perform public.corrigir_prova((x ->> 'id')::uuid, jsonb_build_object(q5, 1)); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 6c: colaborador corrigiu a própria prova'; end if;
  tent := (x ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.corrigir_prova(tent, jsonb_build_object(q5, 0.5), 'Faltou falar do combustível.');
  reset role;
  if (select status from public.treinamento_tentativas where id = tent) <> 'aprovada'
     or (select nota from public.treinamento_tentativas where id = tent) <> 75 then raise exception 'FALHOU 6d: correção'; end if;
  if (select valido_ate::date from public.treinamento_matriculas where treinamento_id = t2 and user_id = mot) <> (now() + interval '12 months')::date then
    raise exception 'FALHOU 6e: validade'; end if;
  if not exists (select 1 from public.notificacoes where user_id = mot and titulo = 'Aprovado em Reciclagem') then raise exception 'FALHOU 6f: aviso'; end if;

  -- 7. Nova versão: copia tudo como rascunho; ao publicar, a anterior sai do ar
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t1v2 := public.nova_versao_treinamento(t1);
  begin perform public.nova_versao_treinamento(t1); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'ja_existe_rascunho' then raise exception 'FALHOU 7: dois rascunhos'; end if;
  if (select count(*) from public.treinamento_alternativas a join public.treinamento_perguntas p on p.id = a.pergunta_id where p.treinamento_id = t1v2) <> 7
    then raise exception 'FALHOU 7b: cópia incompleta'; end if;
  update public.treinamento_etapas set tempo_minimo_seg = 30 where treinamento_id = t1v2 and ordem = 1;
  perform public.publicar_treinamento(t1v2);
  if (select ativo from public.treinamentos where id = t1) then raise exception 'FALHOU 7c: versão antiga no ar'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not exists (select 1 from jsonb_array_elements(public.meus_treinamentos(e)) y where y ->> 'id' = t1v2::text and y ->> 'versao' = '2')
     or exists (select 1 from jsonb_array_elements(public.meus_treinamentos(e)) y where y ->> 'id' = t1::text) then
    raise exception 'FALHOU 7d: lista após nova versão'; end if;
  if (public.meus_dados(e) -> 'treinamentos') is null then raise exception 'FALHOU 7e: exportação LGPD'; end if;
  reset role;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
