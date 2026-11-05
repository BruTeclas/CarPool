-- Testes de isolamento multiempresa (rodar com o seed de dev aplicado).
-- Falha com EXCEPTION se alguma garantia for quebrada. Tudo é desfeito no final.
do $$
declare
  v_admin_a uuid; v_motorista_a uuid; v_admin_b uuid;
  v_ea constant uuid := '11111111-1111-1111-1111-111111111111';
  v_eb constant uuid := '22222222-2222-2222-2222-222222222222';
  n int; v_falhou boolean;
  t text;
begin
  select user_id into v_admin_a from public.membros where empresa_id = v_ea and perfil = 'admin';
  select user_id into v_motorista_a from public.membros where empresa_id = v_ea and perfil = 'motorista';
  select user_id into v_admin_b from public.membros where empresa_id = v_eb and perfil = 'admin';

  -- ===== Admin da empresa A =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  foreach t in array array['empresas','unidades','bases','vagas','membros'] loop
    execute format('select count(*) from public.%I where %s <> %L', t,
      case when t = 'empresas' then 'id' else 'empresa_id' end, v_ea) into n;
    if n <> 0 then raise exception 'FALHOU: admin A enxerga % linhas de outra empresa em %', n, t; end if;
  end loop;

  -- não insere em empresa B
  v_falhou := false;
  begin
    insert into public.unidades (empresa_id, nome) values (v_eb, 'invasora');
  exception when others then v_falhou := true; end;
  if not v_falhou then raise exception 'FALHOU: admin A inseriu unidade na empresa B'; end if;

  -- não altera nem apaga dados da empresa B
  update public.unidades set nome = 'hack' where empresa_id = v_eb;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: admin A alterou % unidades da empresa B', n; end if;
  delete from public.bases where empresa_id = v_eb;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: admin A apagou % bases da empresa B', n; end if;

  -- auditoria: lê só a própria empresa e é append-only
  select count(*) into n from public.registro_de_auditoria where empresa_id <> v_ea;
  if n <> 0 then raise exception 'FALHOU: admin A lê auditoria de outra empresa'; end if;
  select count(*) into n from public.registro_de_auditoria;
  if n = 0 then raise exception 'FALHOU: admin A não vê a própria auditoria'; end if;
  v_falhou := false;
  begin update public.registro_de_auditoria set tabela = 'x'; exception when others then v_falhou := true; end;
  if not v_falhou then raise exception 'FALHOU: auditoria aceitou UPDATE'; end if;
  v_falhou := false;
  begin delete from public.registro_de_auditoria; exception when others then v_falhou := true; end;
  if not v_falhou then raise exception 'FALHOU: auditoria aceitou DELETE'; end if;
  reset role;

  -- ===== Motorista da empresa A =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_motorista_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.unidades;
  if n = 0 then raise exception 'FALHOU: motorista A não vê a própria empresa'; end if;
  v_falhou := false;
  begin insert into public.unidades (empresa_id, nome) values (v_ea, 'sem permissão'); exception when others then v_falhou := true; end;
  if not v_falhou then raise exception 'FALHOU: motorista criou unidade'; end if;
  v_falhou := false;
  begin insert into public.membros (empresa_id, user_id, perfil, nome) values (v_ea, v_motorista_a, 'admin', 'escalada'); exception when others then v_falhou := true; end;
  if not v_falhou then raise exception 'FALHOU: motorista se promoveu a admin'; end if;
  select count(*) into n from public.registro_de_auditoria;
  if n <> 0 then raise exception 'FALHOU: motorista lê auditoria'; end if;
  reset role;

  -- ===== Admin da empresa B só vê B =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.empresas where id = v_ea;
  if n <> 0 then raise exception 'FALHOU: admin B enxerga a empresa A'; end if;
  reset role;

  -- ===== Anônimo não lê nada =====
  set local role anon;
  foreach t in array array['empresas','unidades','bases','vagas','membros','registro_de_auditoria'] loop
    v_falhou := false;
    begin execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then v_falhou := true; end;
    if not v_falhou then raise exception 'FALHOU: anon leu a tabela %', t; end if;
  end loop;
  reset role;

  raise notice 'OK: todos os testes de isolamento passaram';
end $$;
