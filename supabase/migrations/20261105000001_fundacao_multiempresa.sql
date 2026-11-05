-- Sprint 1 · Fundação multiempresa: empresas, unidades, bases, vagas, membros + RLS

create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

create type public.perfil_membro as enum (
  'motorista', 'solicitante', 'aprovador', 'gestor_base',
  'gestor_frota', 'financeiro', 'admin'
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  criado_em timestamptz not null default now()
);

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  criado_em timestamptz not null default now()
);

create table public.bases (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  endereco text,
  criado_em timestamptz not null default now()
);

create table public.vagas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  base_id uuid not null references public.bases(id) on delete cascade,
  codigo text not null check (length(trim(codigo)) > 0),
  criado_em timestamptz not null default now(),
  unique (base_id, codigo)
);

create table public.membros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  perfil public.perfil_membro not null,
  nome text not null check (length(trim(nome)) > 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, user_id, perfil)
);

-- Índices nas chaves estrangeiras e nas buscas de RLS
create index on public.unidades (empresa_id);
create index on public.bases (empresa_id);
create index on public.bases (unidade_id);
create index on public.vagas (empresa_id);
create index on public.vagas (base_id);
create index on public.membros (user_id) where ativo;
create index on public.membros (empresa_id);

-- Funções auxiliares de RLS (schema privado, fora da API)
create or replace function app.empresas_do_usuario()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.empresa_id from public.membros m
  where m.user_id = (select auth.uid()) and m.ativo
$$;

create or replace function app.tem_perfil(p_empresa uuid, p_perfis public.perfil_membro[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.membros m
    where m.user_id = (select auth.uid())
      and m.empresa_id = p_empresa
      and m.ativo
      and m.perfil = any (p_perfis)
  )
$$;

revoke all on function app.empresas_do_usuario() from public, anon;
revoke all on function app.tem_perfil(uuid, public.perfil_membro[]) from public, anon;
grant execute on function app.empresas_do_usuario() to authenticated;
grant execute on function app.tem_perfil(uuid, public.perfil_membro[]) to authenticated;

-- RLS
alter table public.empresas enable row level security;
alter table public.unidades enable row level security;
alter table public.bases enable row level security;
alter table public.vagas enable row level security;
alter table public.membros enable row level security;

revoke all on public.empresas, public.unidades, public.bases, public.vagas, public.membros from anon;

-- Leitura: qualquer membro ativo vê a própria empresa
create policy empresas_select on public.empresas for select to authenticated
  using (id in (select app.empresas_do_usuario()));
create policy unidades_select on public.unidades for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy bases_select on public.bases for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy vagas_select on public.vagas for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy membros_select on public.membros for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));

-- Escrita: admin e gestor de frota mexem nos cadastros físicos
create policy empresas_update on public.empresas for update to authenticated
  using (app.tem_perfil(id, array['admin']::public.perfil_membro[]))
  with check (app.tem_perfil(id, array['admin']::public.perfil_membro[]));

create policy unidades_write on public.unidades for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy bases_write on public.bases for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy vagas_write on public.vagas for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));

-- Membros: só admin gerencia
create policy membros_write on public.membros for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));
