-- Acesso por filial (unidade): cada pessoa só enxerga bases, vagas, veículos, chaves e
-- reservas das filiais liberadas para ela. Administrador e gestor de frota veem todas.

create table public.membro_unidades (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (user_id, unidade_id)
);
create index on public.membro_unidades (unidade_id);
create index on public.membro_unidades (empresa_id);

create or replace function app.usuario_ve_unidade(p_user uuid, p_unidade uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.unidades u
    join public.membros m on m.empresa_id = u.empresa_id and m.user_id = p_user and m.ativo
    where u.id = p_unidade
      and (m.perfil in ('admin', 'gestor_frota')
           or exists (select 1 from public.membro_unidades mu
                      where mu.user_id = p_user and mu.unidade_id = u.id))
  )
$$;

create or replace function app.unidades_do_usuario()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select u.id from public.unidades u
  where u.empresa_id in (select app.empresas_do_usuario())
    and app.usuario_ve_unidade((select auth.uid()), u.id)
$$;

revoke all on function app.usuario_ve_unidade(uuid, uuid) from public, anon;
revoke all on function app.unidades_do_usuario() from public, anon;
grant execute on function app.usuario_ve_unidade(uuid, uuid) to authenticated;
grant execute on function app.unidades_do_usuario() to authenticated;

alter table public.membro_unidades enable row level security;
revoke all on public.membro_unidades from anon;
create policy membro_unidades_select on public.membro_unidades for select to authenticated
  using (user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy membro_unidades_write on public.membro_unidades for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[])
    and exists (select 1 from public.unidades u where u.id = unidade_id and u.empresa_id = membro_unidades.empresa_id));

-- Empresa com uma única filial: quem entra já recebe acesso a ela
create or replace function app.liberar_filial_unica()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.unidades u where u.empresa_id = new.empresa_id) = 1 then
    insert into public.membro_unidades (empresa_id, user_id, unidade_id)
    select new.empresa_id, new.user_id, u.id from public.unidades u where u.empresa_id = new.empresa_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.liberar_filial_unica() from public, anon, authenticated;
create trigger membros_liberar_filial_unica after insert on public.membros
  for each row execute function app.liberar_filial_unica();

-- Leitura restrita à filial
drop policy unidades_select on public.unidades;
create policy unidades_select on public.unidades for select to authenticated
  using (id in (select app.unidades_do_usuario()));

drop policy bases_select on public.bases;
create policy bases_select on public.bases for select to authenticated
  using (unidade_id in (select app.unidades_do_usuario()));

drop policy vagas_select on public.vagas;
create policy vagas_select on public.vagas for select to authenticated
  using (exists (select 1 from public.bases b where b.id = base_id));

-- gestor de base só mexe nas vagas das próprias filiais
drop policy vagas_write on public.vagas;
create policy vagas_write on public.vagas for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[])
    or (app.tem_perfil(empresa_id, array['gestor_base']::public.perfil_membro[])
        and exists (select 1 from public.bases b where b.id = base_id)))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[])
    or (app.tem_perfil(empresa_id, array['gestor_base']::public.perfil_membro[])
        and exists (select 1 from public.bases b where b.id = base_id)));

drop policy veiculos_select on public.veiculos;
create policy veiculos_select on public.veiculos for select to authenticated
  using (exists (select 1 from public.bases b where b.id = base_id));

drop policy chaves_select on public.chaves;
create policy chaves_select on public.chaves for select to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])
    and exists (select 1 from public.veiculos v where v.id = veiculo_id));

-- Reservas: as próprias sempre; as dos outros, só de veículos das filiais liberadas
drop policy reservas_select on public.reservas;
create policy reservas_select on public.reservas for select to authenticated
  using (
    motorista_id = (select auth.uid())
    or solicitante_id = (select auth.uid())
    or (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base','aprovador','financeiro']::public.perfil_membro[])
        and exists (select 1 from public.veiculos v where v.id = veiculo_id))
  );

drop policy avarias_select on public.avarias;
create policy avarias_select on public.avarias for select to authenticated
  using (responsavel_id = (select auth.uid())
    or (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])
        and exists (select 1 from public.veiculos v where v.id = veiculo_id)));

drop policy ocorrencias_select on public.ocorrencias;
create policy ocorrencias_select on public.ocorrencias for select to authenticated
  using (autor_id = (select auth.uid())
    or (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])
        and (veiculo_id is null or exists (select 1 from public.veiculos v where v.id = veiculo_id))));

drop policy os_select on public.ordens_de_servico;
create policy os_select on public.ordens_de_servico for select to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])
    and exists (select 1 from public.veiculos v where v.id = veiculo_id));

-- As funções rodam com privilégio do dono (ignoram RLS), então a filial é conferida nelas também
create or replace function public.disponibilidade(
  p_inicio timestamptz, p_fim timestamptz,
  p_categoria uuid default null, p_base uuid default null
) returns table (veiculo_id uuid, placa text, modelo text, categoria_id uuid, base_id uuid, odometro_km int)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.placa, v.modelo, v.categoria_id, v.base_id, v.odometro_km
  from public.veiculos v
  join public.bases b on b.id = v.base_id
  where v.empresa_id in (select app.empresas_do_usuario())
    and b.unidade_id in (select app.unidades_do_usuario())
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

-- Toda criação e toda mudança de estado de reserva passa por aqui
create or replace function app.conferir_filial_da_reserva()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_unidade uuid;
begin
  if v_uid is null then return new; end if; -- rotinas do sistema e manutenção direta no banco
  select b.unidade_id into v_unidade
  from public.veiculos v join public.bases b on b.id = v.base_id where v.id = new.veiculo_id;
  if tg_op = 'INSERT' then
    if not app.usuario_ve_unidade(v_uid, v_unidade) then
      raise exception 'veiculo_fora_da_sua_filial' using errcode = 'P0001';
    end if;
    if not app.usuario_ve_unidade(new.motorista_id, v_unidade) then
      raise exception 'motorista_sem_acesso_a_filial' using errcode = 'P0001';
    end if;
  elsif new.status is distinct from old.status
        and v_uid not in (old.motorista_id, old.solicitante_id)
        and not app.usuario_ve_unidade(v_uid, v_unidade) then
    raise exception 'reserva_nao_encontrada' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function app.conferir_filial_da_reserva() from public, anon, authenticated;
create trigger reservas_conferir_filial before insert or update on public.reservas
  for each row execute function app.conferir_filial_da_reserva();

-- Leitura de chave: carro de filial não liberada se comporta como etiqueta desconhecida
alter function public.ler_chave(text) rename to ler_chave_base;
alter function public.ler_chave_base(text) set schema app;
revoke all on function app.ler_chave_base(text) from public, anon, authenticated;

create or replace function public.ler_chave(p_codigo text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb := app.ler_chave_base(p_codigo);
begin
  if v ->> 'resultado' = 'sem_reserva' and not exists (
    select 1 from public.chaves c
    join public.veiculos ve on ve.id = c.veiculo_id
    join public.bases b on b.id = ve.base_id
    where c.codigo = p_codigo and b.unidade_id in (select app.unidades_do_usuario())
  ) then
    return jsonb_build_object('resultado', 'chave_desconhecida');
  end if;
  return v;
end;
$$;
revoke all on function public.ler_chave(text) from public, anon;
grant execute on function public.ler_chave(text) to authenticated;
