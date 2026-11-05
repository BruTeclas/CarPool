-- Sprint 2 · Reservas: restrição anti-conflito, eventos imutáveis e máquina de estados no servidor

create extension if not exists btree_gist with schema extensions;

create type public.status_reserva as enum (
  'solicitada', 'aprovada', 'liberada', 'em_uso', 'atrasada',
  'devolvida', 'encerrada', 'no_show', 'cancelada', 'recusada'
);

create table public.reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos(id),
  solicitante_id uuid not null references auth.users(id),
  motorista_id uuid not null references auth.users(id),
  inicio timestamptz not null,
  fim timestamptz not null,
  intervalo_tecnico interval not null default interval '30 minutes',
  -- fim + intervalo é STABLE para timestamptz; por isso fica numa coluna preenchida por trigger
  bloqueio_fim timestamptz not null,
  status public.status_reserva not null default 'solicitada',
  finalidade text,
  destino text,
  passageiros int not null default 0 check (passageiros >= 0),
  centro_de_custo text,
  criado_em timestamptz not null default now(),
  check (fim > inicio)
);

create or replace function app.calcular_bloqueio()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.bloqueio_fim := new.fim + new.intervalo_tecnico;
  return new;
end;
$$;

create trigger reservas_bloqueio before insert or update of fim, intervalo_tecnico on public.reservas
  for each row execute function app.calcular_bloqueio();

alter table public.reservas add constraint sem_sobreposicao
  exclude using gist (
    veiculo_id with =,
    tstzrange(inicio, bloqueio_fim) with &&
  ) where (status in ('aprovada', 'liberada', 'em_uso', 'atrasada'));

create index on public.reservas (empresa_id, inicio);
create index on public.reservas (veiculo_id);
create index on public.reservas (motorista_id, inicio);
create index on public.reservas (solicitante_id);

create table public.eventos_da_reserva (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  de_status public.status_reserva,
  para_status public.status_reserva not null,
  ator_id uuid,
  detalhe jsonb not null default '{}'::jsonb,
  em timestamptz not null default now()
);
create index on public.eventos_da_reserva (reserva_id, em);
create index on public.eventos_da_reserva (empresa_id);

create trigger eventos_sem_update_delete before update or delete on public.eventos_da_reserva
  for each row execute function app.bloquear_alteracao();
create trigger eventos_sem_truncate before truncate on public.eventos_da_reserva
  for each statement execute function app.bloquear_alteracao();

create table public.aprovacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  aprovador_id uuid not null references auth.users(id),
  decisao text not null check (decisao in ('aprovada', 'recusada')),
  justificativa text,
  em timestamptz not null default now()
);
create index on public.aprovacoes (reserva_id);
create index on public.aprovacoes (empresa_id);

-- Acesso: leitura por RLS; escrita SOMENTE pelas funções abaixo
alter table public.reservas enable row level security;
alter table public.eventos_da_reserva enable row level security;
alter table public.aprovacoes enable row level security;

revoke all on public.reservas, public.eventos_da_reserva, public.aprovacoes from anon, authenticated;
grant select on public.reservas, public.eventos_da_reserva, public.aprovacoes to authenticated;

create policy reservas_select on public.reservas for select to authenticated
  using (
    motorista_id = (select auth.uid())
    or solicitante_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base','aprovador','financeiro']::public.perfil_membro[])
  );

create policy eventos_select on public.eventos_da_reserva for select to authenticated
  using (exists (select 1 from public.reservas r where r.id = reserva_id));

create policy aprovacoes_select on public.aprovacoes for select to authenticated
  using (exists (select 1 from public.reservas r where r.id = reserva_id));

create trigger auditar_reservas after insert or update or delete on public.reservas
  for each row execute function app.auditar();

-- Ordem das categorias de CNH (maior letra = mais abrangente)
create or replace function app.nivel_cnh(p_cat text)
returns int language sql immutable set search_path = ''
as $$
  select coalesce(max(position(c in 'ABCDE')), 0)
  from regexp_split_to_table(coalesce(p_cat, ''), '') as c
$$;

create or replace function app.registrar_evento(
  p_reserva public.reservas, p_de public.status_reserva, p_detalhe jsonb
) returns void language sql security definer set search_path = ''
as $$
  insert into public.eventos_da_reserva (empresa_id, reserva_id, de_status, para_status, ator_id, detalhe)
  values (p_reserva.empresa_id, p_reserva.id, p_de, p_reserva.status, (select auth.uid()), coalesce(p_detalhe, '{}'::jsonb))
$$;
revoke all on function app.registrar_evento(public.reservas, public.status_reserva, jsonb) from public, anon, authenticated;

-- Veículos livres em um período (considera intervalo técnico), do mais "descansado" ao mais rodado
create or replace function public.disponibilidade(
  p_inicio timestamptz, p_fim timestamptz,
  p_categoria uuid default null, p_base uuid default null
) returns table (veiculo_id uuid, placa text, modelo text, categoria_id uuid, base_id uuid, odometro_km int)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.placa, v.modelo, v.categoria_id, v.base_id, v.odometro_km
  from public.veiculos v
  where v.empresa_id in (select app.empresas_do_usuario())
    and v.status = 'ativo'
    and (p_categoria is null or v.categoria_id = p_categoria)
    and (p_base is null or v.base_id = p_base)
    and not exists (
      select 1 from public.reservas r
      where r.veiculo_id = v.id
        and r.status in ('aprovada', 'liberada', 'em_uso', 'atrasada')
        and tstzrange(r.inicio, r.bloqueio_fim) && tstzrange(p_inicio, p_fim + interval '30 minutes')
    )
  order by v.odometro_km asc, v.placa
$$;

-- Cria a reserva aplicando as regras da política efetiva
create or replace function public.criar_reserva(
  p_veiculo uuid, p_inicio timestamptz, p_fim timestamptz,
  p_finalidade text default null, p_destino text default null,
  p_passageiros int default 0, p_motorista uuid default null,
  p_centro_de_custo text default null
) returns public.reservas
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_veiculo public.veiculos;
  v_categoria public.categorias;
  v_motorista uuid := coalesce(p_motorista, v_uid);
  v_cfg jsonb;
  v_cnh public.cnhs;
  v_aprovacao boolean := false;
  v_horas_semana numeric;
  v_res public.reservas;
  v_tz constant text := 'America/Sao_Paulo';
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;

  select * into v_veiculo from public.veiculos
   where id = p_veiculo and empresa_id in (select app.empresas_do_usuario());
  if not found then raise exception 'veiculo_nao_encontrado' using errcode = 'P0002'; end if;
  if v_veiculo.status <> 'ativo' then raise exception 'veiculo_indisponivel' using errcode = 'P0001'; end if;

  if v_motorista <> v_uid and not app.tem_perfil(v_veiculo.empresa_id,
       array['solicitante','gestor_base','gestor_frota','admin']::public.perfil_membro[]) then
    raise exception 'sem_permissao_para_reservar_por_outro' using errcode = '42501';
  end if;
  if not exists (select 1 from public.membros m
                 where m.user_id = v_motorista and m.empresa_id = v_veiculo.empresa_id and m.ativo) then
    raise exception 'motorista_fora_da_empresa' using errcode = 'P0001';
  end if;

  v_cfg := app.politica_efetiva(v_veiculo.empresa_id, v_motorista, v_veiculo.base_id);

  if p_inicio < now() + make_interval(hours => (v_cfg ->> 'antecedencia_min_horas')::int) then
    raise exception 'antecedencia_minima_nao_respeitada' using errcode = 'P0001';
  end if;
  if p_inicio > now() + make_interval(days => (v_cfg ->> 'antecedencia_max_dias')::int) then
    raise exception 'antecedencia_maxima_excedida' using errcode = 'P0001';
  end if;
  if p_fim <= p_inicio then raise exception 'periodo_invalido' using errcode = 'P0001'; end if;
  if p_fim - p_inicio > make_interval(hours => (v_cfg ->> 'duracao_max_horas')::int) then
    raise exception 'duracao_maxima_excedida' using errcode = 'P0001';
  end if;

  -- CNH: existe, vale até o fim da reserva e cobre a categoria do veículo
  select * into v_cnh from public.cnhs
   where user_id = v_motorista and empresa_id = v_veiculo.empresa_id;
  if not found then raise exception 'cnh_nao_cadastrada' using errcode = 'P0001'; end if;
  if v_cnh.validade < (p_fim at time zone v_tz)::date then
    raise exception 'cnh_vencida' using errcode = 'P0001';
  end if;
  select * into v_categoria from public.categorias where id = v_veiculo.categoria_id;
  if app.nivel_cnh(v_cnh.categoria) < app.nivel_cnh(v_categoria.cnh_minima) then
    raise exception 'cnh_categoria_incompativel' using errcode = 'P0001';
  end if;

  -- Política vigente aceita
  if (v_cfg ->> 'politica_id') is not null and not exists (
       select 1 from public.aceites_de_politica a
       where a.politica_id = (v_cfg ->> 'politica_id')::uuid and a.user_id = v_motorista) then
    raise exception 'politica_nao_aceita' using errcode = 'P0001';
  end if;

  -- Limite semanal (semana da data de início, horário de Brasília)
  select coalesce(sum(extract(epoch from (r.fim - r.inicio)) / 3600), 0) into v_horas_semana
  from public.reservas r
  where r.motorista_id = v_motorista
    and r.status in ('solicitada', 'aprovada', 'liberada', 'em_uso', 'atrasada', 'devolvida', 'encerrada')
    and date_trunc('week', r.inicio at time zone v_tz) = date_trunc('week', p_inicio at time zone v_tz);
  if v_horas_semana + extract(epoch from (p_fim - p_inicio)) / 3600 > (v_cfg ->> 'limite_semanal_horas')::numeric then
    raise exception 'limite_semanal_excedido' using errcode = 'P0001';
  end if;

  -- Aprovação por alçada: pernoite e fim de semana
  if (v_cfg ->> 'aprovar_pernoite')::boolean
     and (p_inicio at time zone v_tz)::date <> (p_fim at time zone v_tz)::date then
    v_aprovacao := true;
  end if;
  if (v_cfg ->> 'aprovar_fim_de_semana')::boolean
     and (extract(dow from p_inicio at time zone v_tz) in (0, 6)
          or extract(dow from p_fim at time zone v_tz) in (0, 6)) then
    v_aprovacao := true;
  end if;

  begin
    insert into public.reservas (empresa_id, veiculo_id, solicitante_id, motorista_id, inicio, fim,
      intervalo_tecnico, status, finalidade, destino, passageiros, centro_de_custo)
    values (v_veiculo.empresa_id, p_veiculo, v_uid, v_motorista, p_inicio, p_fim,
      make_interval(mins => (v_cfg ->> 'intervalo_tecnico_min')::int),
      case when v_aprovacao then 'solicitada' else 'aprovada' end::public.status_reserva,
      p_finalidade, p_destino, coalesce(p_passageiros, 0), p_centro_de_custo)
    returning * into v_res;
  exception when exclusion_violation then
    raise exception 'conflito_agenda' using errcode = 'P0001';
  end;

  perform app.registrar_evento(v_res, null,
    jsonb_build_object('origem', 'criar_reserva', 'exige_aprovacao', v_aprovacao));
  return v_res;
end;
$$;

-- Única porta de mudança de estado
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

  begin
    update public.reservas set status = p_para where id = p_reserva returning * into v_res;
  exception when exclusion_violation then
    raise exception 'conflito_agenda' using errcode = 'P0001';
  end;

  if v_de = 'solicitada' and p_para in ('aprovada', 'recusada') then
    insert into public.aprovacoes (empresa_id, reserva_id, aprovador_id, decisao, justificativa)
    values (v_res.empresa_id, v_res.id, v_uid, p_para::text, p_detalhe ->> 'justificativa');
  end if;

  perform app.registrar_evento(v_res, v_de, p_detalhe);
  return v_res;
end;
$$;

revoke all on function public.disponibilidade(timestamptz, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.criar_reserva(uuid, timestamptz, timestamptz, text, text, int, uuid, text) from public, anon;
revoke all on function public.transicionar_reserva(uuid, public.status_reserva, jsonb) from public, anon;
grant execute on function public.disponibilidade(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.criar_reserva(uuid, timestamptz, timestamptz, text, text, int, uuid, text) to authenticated;
grant execute on function public.transicionar_reserva(uuid, public.status_reserva, jsonb) to authenticated;
