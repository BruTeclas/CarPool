-- Sprint 6 · se a tela não mandar a empresa (ainda carregando), usa a empresa do próprio usuário
create or replace function public.registrar_demanda_nao_atendida(
  p_empresa uuid, p_inicio timestamptz, p_fim timestamptz, p_categoria uuid default null, p_base uuid default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_empresa uuid := coalesce(p_empresa, (select m.empresa_id from public.membros m where m.user_id = v_uid and m.ativo order by m.criado_em limit 1));
begin
  if v_uid is null or v_empresa is null or v_empresa not in (select app.empresas_do_usuario()) or p_fim <= p_inicio then return; end if;
  if exists (select 1 from public.demandas_nao_atendidas d
             where d.user_id = v_uid and d.empresa_id = v_empresa and d.inicio = p_inicio and d.fim = p_fim
               and d.categoria_id is not distinct from p_categoria and d.em > now() - interval '30 minutes') then
    return;
  end if;
  insert into public.demandas_nao_atendidas (empresa_id, user_id, inicio, fim, categoria_id, base_id)
  values (v_empresa, v_uid, p_inicio, p_fim, p_categoria, p_base);
end;
$$;
