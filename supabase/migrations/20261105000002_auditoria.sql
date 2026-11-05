-- Sprint 1 · Trilha de auditoria append-only

create table public.registro_de_auditoria (
  id bigint generated always as identity primary key,
  empresa_id uuid,
  user_id uuid,
  tabela text not null,
  operacao text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  registro_id uuid,
  antes jsonb,
  depois jsonb,
  em timestamptz not null default now()
);

create index on public.registro_de_auditoria (empresa_id, em desc);

alter table public.registro_de_auditoria enable row level security;
revoke all on public.registro_de_auditoria from anon, authenticated;
grant select on public.registro_de_auditoria to authenticated;

create policy auditoria_select on public.registro_de_auditoria for select to authenticated
  using (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));

-- Ninguém altera nem apaga o registro, nem o dono da tabela
create or replace function app.bloquear_alteracao()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Tabela % é append-only: % não permitido', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create trigger auditoria_sem_update_delete
  before update or delete on public.registro_de_auditoria
  for each row execute function app.bloquear_alteracao();
create trigger auditoria_sem_truncate
  before truncate on public.registro_de_auditoria
  for each statement execute function app.bloquear_alteracao();

-- Gravação só pelo trigger (a função roda como dono e ignora RLS)
create or replace function app.auditar()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_novo jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_antigo jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_base jsonb := coalesce(v_novo, v_antigo);
  v_empresa uuid;
begin
  v_empresa := coalesce(
    (v_base ->> 'empresa_id')::uuid,
    case when tg_table_name = 'empresas' then (v_base ->> 'id')::uuid end
  );
  insert into public.registro_de_auditoria
    (empresa_id, user_id, tabela, operacao, registro_id, antes, depois)
  values
    (v_empresa, (select auth.uid()), tg_table_name, tg_op,
     (v_base ->> 'id')::uuid, v_antigo, v_novo);
  return coalesce(new, old);
end;
$$;

revoke all on function app.auditar() from public, anon, authenticated;

create trigger auditar_empresas after insert or update or delete on public.empresas
  for each row execute function app.auditar();
create trigger auditar_unidades after insert or update or delete on public.unidades
  for each row execute function app.auditar();
create trigger auditar_bases after insert or update or delete on public.bases
  for each row execute function app.auditar();
create trigger auditar_vagas after insert or update or delete on public.vagas
  for each row execute function app.auditar();
create trigger auditar_membros after insert or update or delete on public.membros
  for each row execute function app.auditar();
