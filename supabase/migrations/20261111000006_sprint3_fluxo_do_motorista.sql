-- Sprint 3 · aceite de política, reserva por categoria, horários alternativos,
-- recusa com justificativa, cancelamento tardio e proteção do último administrador

-- Nova regra configurável: cancelar com menos de X horas conta como cancelamento tardio
create or replace function app.politica_padrao()
returns jsonb language sql immutable set search_path = ''
as $$
  select '{
    "antecedencia_min_horas": 1,
    "antecedencia_max_dias": 60,
    "duracao_max_horas": 12,
    "limite_semanal_horas": 40,
    "intervalo_tecnico_min": 30,
    "tolerancia_noshow_min": 30,
    "tolerancia_atraso_min": 15,
    "cancelamento_min_horas": 2,
    "aprovar_pernoite": true,
    "aprovar_fim_de_semana": true
  }'::jsonb
$$;

-- Políticas ativas que valem para o usuário e que ele ainda não aceitou
create or replace function public.politicas_pendentes(p_empresa uuid)
returns table (id uuid, nome text, versao int, config jsonb)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.nome, p.versao, app.politica_padrao() || p.config
  from public.politicas p
  where p.empresa_id = p_empresa
    and p_empresa in (select app.empresas_do_usuario())
    and p.ativa
    and (p.grupo_id is null or p.grupo_id in (
      select gm.grupo_id from public.grupo_membros gm where gm.user_id = (select auth.uid())))
    and not exists (
      select 1 from public.aceites_de_politica a
      where a.politica_id = p.id and a.user_id = (select auth.uid()))
  order by p.nome
$$;

-- Próximos horários (até 3, em passos de 30 min, nas 96 h seguintes) em que há veículo livre
create or replace function public.sugerir_horarios(
  p_inicio timestamptz, p_fim timestamptz,
  p_categoria uuid default null, p_veiculo uuid default null
) returns table (inicio timestamptz, fim timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_dur interval := p_fim - p_inicio;
  v_t timestamptz := p_inicio;
  v_n int := 0;
begin
  if (select auth.uid()) is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;
  if v_dur <= interval '0' or v_dur > interval '7 days' then return; end if;
  for i in 1..192 loop
    v_t := v_t + interval '30 minutes';
    if exists (
      select 1 from public.disponibilidade(v_t, v_t + v_dur, p_categoria, null) d
      where p_veiculo is null or d.veiculo_id = p_veiculo
    ) then
      inicio := v_t; fim := v_t + v_dur;
      return next;
      v_n := v_n + 1;
      exit when v_n >= 3;
      v_t := v_t + interval '30 minutes';
    end if;
  end loop;
end;
$$;

-- Reserva por categoria: o sistema escolhe a placa (menor odômetro primeiro)
create or replace function public.criar_reserva_por_categoria(
  p_categoria uuid, p_inicio timestamptz, p_fim timestamptz,
  p_finalidade text default null, p_destino text default null,
  p_passageiros int default 0, p_base uuid default null
) returns public.reservas
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_res public.reservas;
begin
  for v in select d.veiculo_id from public.disponibilidade(p_inicio, p_fim, p_categoria, p_base) d loop
    begin
      v_res := public.criar_reserva(v.veiculo_id, p_inicio, p_fim, p_finalidade, p_destino, p_passageiros);
      return v_res;
    exception when others then
      if sqlerrm <> 'conflito_agenda' then raise; end if;
    end;
  end loop;
  raise exception 'sem_veiculo_disponivel' using errcode = 'P0001';
end;
$$;

-- Máquina de estados: recusa exige justificativa; cancelamento em cima da hora fica marcado
create or replace function public.transicionar_reserva(
  p_reserva uuid, p_para public.status_reserva,
  p_detalhe jsonb default '{}'::jsonb
) returns public.reservas
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sistema boolean := coalesce((select auth.role()), '') = 'service_role';
  v_res public.reservas;
  v_de public.status_reserva;
  v_dono boolean;
  v_gestao boolean;
  v_operacao boolean;
  v_aprovador boolean;
  v_ok boolean := false;
  v_detalhe jsonb := coalesce(p_detalhe, '{}'::jsonb);
  v_cfg jsonb;
begin
  if v_uid is null and not v_sistema then raise exception 'nao_autenticado' using errcode = '28000'; end if;

  select * into v_res from public.reservas where id = p_reserva for update;
  if not found or (not v_sistema and v_res.empresa_id not in (select app.empresas_do_usuario())) then
    raise exception 'reserva_nao_encontrada' using errcode = 'P0002';
  end if;
  v_de := v_res.status;

  v_dono := v_uid is not null and (v_res.motorista_id = v_uid or v_res.solicitante_id = v_uid);
  v_gestao := v_sistema or app.tem_perfil(v_res.empresa_id, array['admin','gestor_frota']::public.perfil_membro[]);
  v_operacao := v_gestao or app.tem_perfil(v_res.empresa_id, array['gestor_base']::public.perfil_membro[]);
  v_aprovador := v_gestao or app.tem_perfil(v_res.empresa_id, array['aprovador']::public.perfil_membro[]);

  v_ok := case
    when v_de = 'solicitada' and p_para in ('aprovada', 'recusada') then v_aprovador
    when v_de = 'solicitada' and p_para = 'cancelada' then v_dono or v_gestao
    when v_de = 'aprovada'   and p_para = 'liberada' then v_operacao
    when v_de = 'aprovada'   and p_para = 'cancelada' then v_dono or v_gestao
    when v_de = 'aprovada'   and p_para = 'no_show' then v_operacao
    when v_de = 'liberada'   and p_para = 'em_uso' then v_dono or v_operacao
    when v_de = 'liberada'   and p_para in ('no_show', 'cancelada') then v_operacao
    when v_de = 'em_uso'     and p_para = 'devolvida' then v_dono or v_operacao
    when v_de = 'em_uso'     and p_para = 'atrasada' then v_operacao
    when v_de = 'atrasada'   and p_para = 'devolvida' then v_dono or v_operacao
    when v_de = 'devolvida'  and p_para = 'encerrada' then v_operacao
    else false
  end;
  if not v_ok then
    raise exception 'transicao_nao_permitida: % -> %', v_de, p_para using errcode = '42501';
  end if;

  if p_para = 'recusada' and coalesce(trim(v_detalhe ->> 'justificativa'), '') = '' then
    raise exception 'justificativa_obrigatoria' using errcode = 'P0001';
  end if;

  if p_para = 'cancelada' then
    v_cfg := app.politica_efetiva(v_res.empresa_id, v_res.motorista_id,
      (select ve.base_id from public.veiculos ve where ve.id = v_res.veiculo_id));
    if now() > v_res.inicio - make_interval(hours => (v_cfg ->> 'cancelamento_min_horas')::int) then
      v_detalhe := v_detalhe || '{"cancelamento_tardio": true}'::jsonb;
    end if;
  end if;

  begin
    update public.reservas set status = p_para where id = p_reserva returning * into v_res;
  exception when exclusion_violation then
    raise exception 'conflito_agenda' using errcode = 'P0001';
  end;

  if v_de = 'solicitada' and p_para in ('aprovada', 'recusada') then
    insert into public.aprovacoes (empresa_id, reserva_id, aprovador_id, decisao, justificativa)
    values (v_res.empresa_id, v_res.id, v_uid, p_para::text, v_detalhe ->> 'justificativa');
  end if;

  perform app.registrar_evento(v_res, v_de, v_detalhe);
  return v_res;
end;
$$;

-- A empresa nunca fica sem administrador ativo (por edição; exclusões em cascata seguem livres)
create or replace function app.proteger_ultimo_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.perfil = 'admin' and old.ativo and (new.perfil <> 'admin' or not new.ativo)
     and not exists (
       select 1 from public.membros m
       where m.empresa_id = old.empresa_id and m.perfil = 'admin' and m.ativo and m.id <> old.id) then
    raise exception 'ultimo_admin' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function app.proteger_ultimo_admin() from public, anon, authenticated;

create trigger membros_ultimo_admin before update on public.membros
  for each row execute function app.proteger_ultimo_admin();

revoke all on function public.politicas_pendentes(uuid) from public, anon;
revoke all on function public.sugerir_horarios(timestamptz, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.criar_reserva_por_categoria(uuid, timestamptz, timestamptz, text, text, int, uuid) from public, anon;
grant execute on function public.politicas_pendentes(uuid) to authenticated;
grant execute on function public.sugerir_horarios(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.criar_reserva_por_categoria(uuid, timestamptz, timestamptz, text, text, int, uuid) to authenticated;
