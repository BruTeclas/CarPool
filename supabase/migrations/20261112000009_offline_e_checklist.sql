-- Sprint 4 (parte 2) · apoio ao modo offline e checklist configurável por categoria

-- Checklist configurável: por categoria de veículo ou para a empresa toda
create table public.checklist_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  categoria_id uuid references public.categorias(id) on delete cascade,
  item text not null check (length(trim(item)) > 0),
  critico boolean not null default false,
  ordem int not null default 1,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index on public.checklist_itens (empresa_id);
create index on public.checklist_itens (categoria_id);
alter table public.checklist_itens enable row level security;
revoke all on public.checklist_itens from anon;
create policy checklist_itens_select on public.checklist_itens for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy checklist_itens_write on public.checklist_itens for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create trigger auditar_checklist_itens after insert or update or delete on public.checklist_itens
  for each row execute function app.auditar();

-- Ordem de escolha: lista da categoria do veículo > lista geral da empresa > padrão do sistema
create or replace function app.checklist_efetivo(p_veiculo uuid)
returns table (item text, critico boolean, ordem int)
language plpgsql stable security definer set search_path = ''
as $$
declare v_empresa uuid; v_categoria uuid;
begin
  select v.empresa_id, v.categoria_id into v_empresa, v_categoria from public.veiculos v where v.id = p_veiculo;
  if exists (select 1 from public.checklist_itens c where c.empresa_id = v_empresa and c.categoria_id = v_categoria and c.ativo) then
    return query select c.item, c.critico, c.ordem from public.checklist_itens c
      where c.empresa_id = v_empresa and c.categoria_id = v_categoria and c.ativo order by c.ordem, c.item;
  elsif exists (select 1 from public.checklist_itens c where c.empresa_id = v_empresa and c.categoria_id is null and c.ativo) then
    return query select c.item, c.critico, c.ordem from public.checklist_itens c
      where c.empresa_id = v_empresa and c.categoria_id is null and c.ativo order by c.ordem, c.item;
  else
    return query select p.item, p.critico, p.ordem from public.checklist_padrao() p order by p.ordem;
  end if;
end;
$$;
revoke all on function app.checklist_efetivo(uuid) from public, anon, authenticated;

create or replace function public.checklist_da_reserva(p_reserva uuid)
returns table (item text, critico boolean, ordem int)
language sql stable security definer set search_path = ''
as $$
  select c.item, c.critico, c.ordem
  from public.reservas r, app.checklist_efetivo(r.veiculo_id) c
  where r.id = p_reserva and r.empresa_id in (select app.empresas_do_usuario())
$$;
revoke all on function public.checklist_da_reserva(uuid) from public, anon;
grant execute on function public.checklist_da_reserva(uuid) to authenticated;

-- "Crítico" de cada item gravado vem sempre do checklist do servidor, nunca do aparelho
create or replace function app.definir_item_critico()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.critico := coalesce((
    select c.critico from public.vistorias v, app.checklist_efetivo(v.veiculo_id) c
    where v.id = new.vistoria_id and c.item = new.item limit 1), false);
  return new;
end;
$$;
revoke all on function app.definir_item_critico() from public, anon, authenticated;
create trigger itens_definir_critico before insert on public.itens_de_vistoria
  for each row execute function app.definir_item_critico();

-- Pacote que o aparelho guarda para funcionar sem sinal. Da chave vai só o resumo SHA-256.
create or replace function public.minhas_reservas_offline()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'empresa_id', r.empresa_id, 'status', r.status, 'inicio', r.inicio, 'fim', r.fim,
    'codigo_retirada', r.codigo_retirada, 'placa', v.placa, 'modelo', v.modelo, 'odometro_km', v.odometro_km,
    'chave_sha256', encode(sha256(convert_to(c.codigo, 'UTF8')), 'hex'),
    'tolerancia_noshow_min', (app.politica_efetiva(r.empresa_id, r.motorista_id, v.base_id) ->> 'tolerancia_noshow_min')::int,
    'checklist', (select jsonb_agg(jsonb_build_object('item', k.item, 'critico', k.critico, 'ordem', k.ordem) order by k.ordem)
                  from app.checklist_efetivo(v.id) k)
  ) order by r.inicio), '[]'::jsonb)
  from public.reservas r
  join public.veiculos v on v.id = r.veiculo_id
  join public.chaves c on c.veiculo_id = v.id
  where r.motorista_id = (select auth.uid())
    and r.status in ('aprovada', 'liberada', 'em_uso', 'atrasada')
    and r.inicio < now() + interval '7 days'
$$;
revoke all on function public.minhas_reservas_offline() from public, anon;
grant execute on function public.minhas_reservas_offline() to authenticated;

-- Leitura de chave com horário do aparelho (feita sem sinal e enviada depois).
-- O horário é aceito só se não estiver no futuro nem tiver mais de 48 h.
drop function public.ler_chave(text);
create or replace function public.ler_chave(p_codigo text, p_lido_em timestamptz default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v jsonb;
  v_ve public.veiculos;
  v_res public.reservas;
  v_cfg jsonb;
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;

  if p_lido_em is not null and p_lido_em <= now() and p_lido_em >= now() - interval '48 hours' then
    select ve.* into v_ve from public.chaves c join public.veiculos ve on ve.id = c.veiculo_id
     where c.codigo = p_codigo and ve.empresa_id in (select app.empresas_do_usuario());
    if found then
      select * into v_res from public.reservas
       where veiculo_id = v_ve.id and motorista_id = v_uid and status = 'aprovada'
         and p_lido_em >= inicio - interval '15 minutes'
       order by inicio limit 1;
      if found then
        v_cfg := app.politica_efetiva(v_res.empresa_id, v_uid, v_ve.base_id);
        if p_lido_em <= v_res.inicio + make_interval(mins => (v_cfg ->> 'tolerancia_noshow_min')::int)
           and v_ve.status = 'ativo'
           and exists (select 1 from public.cnhs c where c.user_id = v_uid and c.empresa_id = v_res.empresa_id
                       and c.validade >= (p_lido_em at time zone 'America/Sao_Paulo')::date) then
          perform app.mudar_status(v_res.id, 'liberada',
            jsonb_build_object('via', 'qr', 'offline', true, 'lido_em', p_lido_em));
          return jsonb_build_object('resultado', 'chave_certa', 'reserva_id', v_res.id,
                                    'placa', v_ve.placa, 'modelo', v_ve.modelo, 'offline', true);
        end if;
      end if;
    end if;
  end if;

  v := app.ler_chave_base(p_codigo);
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
revoke all on function public.ler_chave(text, timestamptz) from public, anon;
grant execute on function public.ler_chave(text, timestamptz) to authenticated;
