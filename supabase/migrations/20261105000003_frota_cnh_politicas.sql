-- Sprint 2 · Frota, CNH, grupos e políticas configuráveis

create type public.status_veiculo as enum ('ativo', 'manutencao', 'bloqueado', 'inativo');

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  cnh_minima text not null default 'B' check (cnh_minima ~ '^[A-E]$'),
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table public.veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  base_id uuid not null references public.bases(id),
  categoria_id uuid not null references public.categorias(id),
  placa text not null check (placa ~ '^[A-Z0-9]{7}$'),
  modelo text not null check (length(trim(modelo)) > 0),
  ano int check (ano between 1980 and 2100),
  odometro_km int not null default 0 check (odometro_km >= 0),
  combustivel text,
  status public.status_veiculo not null default 'ativo',
  criado_em timestamptz not null default now(),
  unique (empresa_id, placa)
);

create table public.cnhs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  numero text not null,
  categoria text not null check (categoria ~ '^[A-E]{1,2}$'),
  validade date not null,
  ultima_revalidacao date,
  criado_em timestamptz not null default now(),
  unique (empresa_id, user_id)
);

create table public.grupos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table public.grupo_membros (
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (grupo_id, user_id)
);

create table public.politicas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  versao int not null default 1 check (versao > 0),
  ativa boolean not null default true,
  grupo_id uuid references public.grupos(id) on delete cascade,
  base_id uuid references public.bases(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome, versao)
);

create table public.aceites_de_politica (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  politica_id uuid not null references public.politicas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  aceito_em timestamptz not null default now(),
  unique (politica_id, user_id)
);

create index on public.categorias (empresa_id);
create index on public.veiculos (empresa_id);
create index on public.veiculos (base_id);
create index on public.veiculos (categoria_id);
create index on public.cnhs (empresa_id);
create index on public.cnhs (user_id);
create index on public.grupos (empresa_id);
create index on public.grupo_membros (user_id);
create index on public.grupo_membros (empresa_id);
create index on public.politicas (empresa_id) where ativa;
create index on public.politicas (grupo_id);
create index on public.politicas (base_id);
create index on public.aceites_de_politica (empresa_id);
create index on public.aceites_de_politica (user_id);

-- Valores padrão do estudo; a política da empresa/grupo/base sobrescreve chave a chave.
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
    "aprovar_pernoite": true,
    "aprovar_fim_de_semana": true
  }'::jsonb
$$;

-- Política efetiva: grupo > base > empresa; mais versão recente vence.
create or replace function app.politica_efetiva(p_empresa uuid, p_user uuid, p_base uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select app.politica_padrao() || coalesce((
    select p.config || jsonb_build_object('politica_id', p.id)
    from public.politicas p
    where p.empresa_id = p_empresa and p.ativa
      and (p.grupo_id is null or p.grupo_id in (select gm.grupo_id from public.grupo_membros gm where gm.user_id = p_user))
      and (p.base_id is null or p.base_id = p_base)
    order by (p.grupo_id is not null) desc, (p.base_id is not null) desc, p.versao desc
    limit 1
  ), '{}'::jsonb)
$$;

revoke all on function app.politica_padrao() from public, anon;
revoke all on function app.politica_efetiva(uuid, uuid, uuid) from public, anon;
grant execute on function app.politica_padrao() to authenticated;
grant execute on function app.politica_efetiva(uuid, uuid, uuid) to authenticated;

-- RLS
alter table public.categorias enable row level security;
alter table public.veiculos enable row level security;
alter table public.cnhs enable row level security;
alter table public.grupos enable row level security;
alter table public.grupo_membros enable row level security;
alter table public.politicas enable row level security;
alter table public.aceites_de_politica enable row level security;

revoke all on public.categorias, public.veiculos, public.cnhs, public.grupos,
  public.grupo_membros, public.politicas, public.aceites_de_politica from anon;

create policy categorias_select on public.categorias for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy veiculos_select on public.veiculos for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy grupos_select on public.grupos for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy grupo_membros_select on public.grupo_membros for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy politicas_select on public.politicas for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));

-- CNH é dado sensível: o próprio titular e a gestão enxergam
create policy cnhs_select on public.cnhs for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])
  );

create policy aceites_select on public.aceites_de_politica for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[])
  );
create policy aceites_insert on public.aceites_de_politica for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and empresa_id in (select app.empresas_do_usuario())
  );

create policy categorias_write on public.categorias for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy veiculos_write on public.veiculos for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy cnhs_write on public.cnhs for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy grupos_write on public.grupos for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy grupo_membros_write on public.grupo_membros for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy politicas_write on public.politicas for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));

-- Auditoria
create trigger auditar_categorias after insert or update or delete on public.categorias
  for each row execute function app.auditar();
create trigger auditar_veiculos after insert or update or delete on public.veiculos
  for each row execute function app.auditar();
create trigger auditar_cnhs after insert or update or delete on public.cnhs
  for each row execute function app.auditar();
create trigger auditar_grupos after insert or update or delete on public.grupos
  for each row execute function app.auditar();
create trigger auditar_politicas after insert or update or delete on public.politicas
  for each row execute function app.auditar();
create trigger auditar_aceites after insert or update or delete on public.aceites_de_politica
  for each row execute function app.auditar();
