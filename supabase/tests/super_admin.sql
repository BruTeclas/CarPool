-- Testes do super admin (empresas, módulos, limites, suspensão, suporte). Desfaz tudo.
-- Sucesso = termina com a exceção 'OK_TESTES_PASSARAM'.
do $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  sa uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); mot uuid := gen_random_uuid(); novo uuid := gen_random_uuid();
  e uuid; e2 uuid; uni uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); car uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); msg text; n int; j jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  select u, zero, 'authenticated', 'authenticated', 'ts-' || u || '@teste.invalid' from unnest(array[sa, adm, mot, novo]) u;
  insert into public.super_admins (user_id, nome) values (sa, 'Equipe');

  -- 1. Só super admin usa o painel
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.sou_super_admin() then raise exception 'FALHOU 1: comum virou super'; end if;
  begin perform public.super_empresas(); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 1b: comum viu empresas'; end if;
  reset role;

  -- 2. Cadastro de empresa com CNPJ conferido
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.super_salvar_empresa(null, 'Errada', null, '11.222.333/0001-82', array['relatorios'], null, null, null); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'cnpj_invalido' then raise exception 'FALHOU 2: %', msg; end if;
  e := public.super_salvar_empresa(null, 'Transportes Teste', 'Transportes Teste Ltda', '11.222.333/0001-81',
         array['treinamentos', 'relatorios', 'documentos', 'ocorrencias'], 2, 1, 1);
  begin perform public.super_salvar_empresa(null, 'Outra', null, '11222333000181', null, null, null, null); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'cnpj_ja_cadastrado' then raise exception 'FALHOU 2b: %', msg; end if;
  if not exists (select 1 from jsonb_array_elements(public.super_empresas()) x where x ->> 'id' = e::text and x ->> 'cnpj' = '11222333000181') then
    raise exception 'FALHOU 2c: lista'; end if;
  reset role;

  insert into public.unidades (id, empresa_id, nome) values (uni, e, 'Matriz');
  insert into public.bases (id, empresa_id, unidade_id, nome) values (b, e, uni, 'Pátio');
  insert into public.categorias (id, empresa_id, nome) values (cat, e, 'Hatch');
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e, adm, 'admin', 'Adm'), (e, mot, 'motorista', 'Mot');
  update public.tipos_de_documento set obrigatorio = false where empresa_id = e;

  -- 3. O admin do cliente não mexe no que é do super admin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update public.empresas set modulos = '{}' where id = e; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 3: admin mudou módulos (%)', msg; end if;
  begin update public.empresas set situacao = 'ativa', limite_usuarios = 999 where id = e; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 3b: admin mudou limite'; end if;
  update public.empresas set encarregado_contato = 'dpo@exemplo.invalid' where id = e;   -- o que é dele continua livre
  -- 4. Limites do plano
  insert into public.veiculos (id, empresa_id, base_id, categoria_id, placa, modelo) values (car, e, b, cat, 'SUP0001', 'Um');
  begin insert into public.veiculos (empresa_id, base_id, categoria_id, placa, modelo) values (e, b, cat, 'SUP0002', 'Dois'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'limite_do_plano: veiculos' then raise exception 'FALHOU 4: %', msg; end if;
  begin insert into public.unidades (empresa_id, nome) values (e, 'Filial 2'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'limite_do_plano: filiais' then raise exception 'FALHOU 4b: %', msg; end if;
  begin insert into public.membros (empresa_id, user_id, perfil, nome) values (e, novo, 'motorista', 'Novo'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'limite_do_plano: usuarios' then raise exception 'FALHOU 4c: %', msg; end if;
  insert into public.membros (empresa_id, user_id, perfil, nome) values (e, mot, 'aprovador', 'Mot');   -- mesma pessoa, outro perfil: não conta
  reset role;

  -- 5. Módulos desligados
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.super_salvar_empresa(e, 'Transportes Teste', 'Transportes Teste Ltda', '11222333000181', array['documentos'], 2, 1, 1);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.relatorio_frota(e, current_date - 7, current_date); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'modulo_desligado: relatorios' then raise exception 'FALHOU 5: %', msg; end if;
  begin insert into public.comunicados (empresa_id, titulo, texto, criado_por) values (e, 'x', 'y', adm); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'modulo_desligado: treinamentos' then raise exception 'FALHOU 5b: %', msg; end if;
  reset role;

  -- 6. Suspensão: não reserva nem retira; devolver continua possível
  insert into public.reservas (id, empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim, status)
  values (r1, e, car, mot, mot, now() + interval '1 day', now() + interval '1 day 1 hour', 'aprovada');
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.super_suspender_empresa(e, true, ''); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'motivo_obrigatorio' then raise exception 'FALHOU 6: suspendeu sem motivo'; end if;
  perform public.super_suspender_empresa(e, true, 'Pagamento em atraso');
  reset role;
  begin insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim) values (e, car, mot, mot, now() + interval '2 days', now() + interval '2 days 1 hour'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'empresa_suspensa' then raise exception 'FALHOU 6b: %', msg; end if;
  begin update public.reservas set status = 'liberada' where id = r1; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'empresa_suspensa' then raise exception 'FALHOU 6c: retirada com empresa suspensa (%)', msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (public.pendencias_para_reservar(e) ->> 'empresa_suspensa')::boolean is not true then raise exception 'FALHOU 6d: pendência'; end if;
  reset role;

  -- 7. Suporte: com motivo, por tempo limitado, fora dos públicos; comum não entra
  perform set_config('request.jwt.claims', json_build_object('sub', mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.super_entrar_como(e, 'curioso demais'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'sem_permissao' then raise exception 'FALHOU 7: comum entrou como suporte'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if e in (select app.empresas_do_usuario()) then raise exception 'FALHOU 7b: super vê empresa sem suporte'; end if;
  begin perform public.super_entrar_como(e, 'oi'); msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'motivo_obrigatorio' then raise exception 'FALHOU 7c: suporte sem motivo'; end if;
  perform public.super_entrar_como(e, 'Chamado 123: ajuda com a frota');   -- entra mesmo com a empresa suspensa
  if e not in (select app.empresas_do_usuario()) or not app.tem_perfil(e, array['admin']::public.perfil_membro[]) then raise exception 'FALHOU 7d: suporte sem acesso'; end if;
  select count(*) into n from public.veiculos where empresa_id = e;
  if n <> 1 then raise exception 'FALHOU 7e: suporte não vê a frota'; end if;
  if (select count(*) from public.super_admins_da_empresa(e)) <> 1 then raise exception 'FALHOU 7g: suporte contado como admin'; end if;
  reset role;
  if app.publico_inclui(e, null, null, null, sa) then raise exception 'FALHOU 7f: suporte entrou no público'; end if;
  if not exists (select 1 from public.registro_de_auditoria where tabela = 'membros' and empresa_id = e and depois ->> 'suporte_motivo' = 'Chamado 123: ajuda com a frota') then
    raise exception 'FALHOU 7h: acesso de suporte sem registro'; end if;
  -- o último admin de verdade não pode sair só porque o suporte está lá
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update public.membros set ativo = false where empresa_id = e and user_id = adm; msg := null; exception when others then msg := sqlerrm; end;
  if msg is distinct from 'ultimo_admin' then raise exception 'FALHOU 7i: %', msg; end if;
  reset role;
  -- vencido, o acesso some
  update public.membros set suporte_ate = now() - interval '1 minute' where user_id = sa;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if e in (select app.empresas_do_usuario()) then raise exception 'FALHOU 7j: suporte vencido continua'; end if;
  perform public.super_sair_suporte();
  reset role;
  if exists (select 1 from public.membros where user_id = sa) then raise exception 'FALHOU 7k: vínculo de suporte ficou'; end if;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
