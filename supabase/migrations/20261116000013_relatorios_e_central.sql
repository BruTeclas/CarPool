-- Sprint 6 · Relatórios, demanda não atendida e central da portaria em tempo real

-- Demanda não atendida: busca de veículo que não encontrou nenhum livre
create table public.demandas_nao_atendidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  categoria_id uuid references public.categorias(id) on delete set null,
  base_id uuid references public.bases(id) on delete set null,
  em timestamptz not null default now(),
  check (fim > inicio)
);
create index on public.demandas_nao_atendidas (empresa_id, inicio);
create index on public.demandas_nao_atendidas (user_id);
create index on public.demandas_nao_atendidas (categoria_id);
create index on public.demandas_nao_atendidas (base_id);

alter table public.demandas_nao_atendidas enable row level security;
revoke all on public.demandas_nao_atendidas from anon, authenticated;
grant select on public.demandas_nao_atendidas to authenticated;
create policy demandas_select on public.demandas_nao_atendidas for select to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base','financeiro']::public.perfil_membro[]));

create or replace function public.registrar_demanda_nao_atendida(
  p_empresa uuid, p_inicio timestamptz, p_fim timestamptz, p_categoria uuid default null, p_base uuid default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_empresa not in (select app.empresas_do_usuario()) or p_fim <= p_inicio then return; end if;
  -- a mesma busca repetida em poucos minutos conta uma vez
  if exists (select 1 from public.demandas_nao_atendidas d
             where d.user_id = v_uid and d.empresa_id = p_empresa and d.inicio = p_inicio and d.fim = p_fim
               and d.categoria_id is not distinct from p_categoria and d.em > now() - interval '30 minutes') then
    return;
  end if;
  insert into public.demandas_nao_atendidas (empresa_id, user_id, inicio, fim, categoria_id, base_id)
  values (p_empresa, v_uid, p_inicio, p_fim, p_categoria, p_base);
end;
$$;
revoke all on function public.registrar_demanda_nao_atendida(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.registrar_demanda_nao_atendida(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;

-- Quem vê relatórios: admin, gestor de frota e financeiro veem a empresa toda; gestor de base, as filiais liberadas
create or replace function app.ve_no_relatorio(p_empresa uuid, p_unidade uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select app.tem_perfil(p_empresa, array['admin','gestor_frota','financeiro']::public.perfil_membro[])
      or (app.tem_perfil(p_empresa, array['gestor_base']::public.perfil_membro[])
          and app.usuario_ve_unidade((select auth.uid()), p_unidade))
$$;
revoke all on function app.ve_no_relatorio(uuid, uuid) from public, anon, authenticated;

-- Retirada e devolução reais de uma reserva (vistorias; sem vistoria, o início e o encerramento)
create or replace view app.uso_real as
  select r.id as reserva_id, r.empresa_id, r.veiculo_id, r.motorista_id, r.inicio, r.fim, r.status, r.centro_de_custo,
         r.finalidade, r.destino,
         coalesce(s.criado_em, case when r.status in ('em_uso','atrasada','devolvida','encerrada','ocorrencia') then r.inicio end) as retirada,
         coalesce(c.criado_em,
                  (select min(e.em) from public.eventos_da_reserva e where e.reserva_id = r.id and e.para_status in ('devolvida','encerrada')),
                  case when r.status in ('em_uso','atrasada','ocorrencia') then now() end) as devolucao,
         case when c.odometro_km is not null and s.odometro_km is not null then c.odometro_km - s.odometro_km end as km,
         exists (select 1 from public.eventos_da_reserva e where e.reserva_id = r.id and e.para_status = 'atrasada') as atrasou
  from public.reservas r
  left join public.vistorias s on s.reserva_id = r.id and s.tipo = 'saida'
  left join public.vistorias c on c.reserva_id = r.id and c.tipo = 'chegada';

-- Horas de sobreposição entre um intervalo e o período do relatório
create or replace function app.horas_no_periodo(p_ini timestamptz, p_fim timestamptz, p_de timestamptz, p_ate timestamptz)
returns numeric language sql immutable set search_path = ''
as $$ select greatest(0, extract(epoch from (least(p_fim, p_ate) - greatest(p_ini, p_de))) / 3600)::numeric $$;

create or replace function public.relatorio_frota(p_empresa uuid, p_inicio date, p_fim date, p_unidade uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_de timestamptz := (p_inicio::timestamp) at time zone 'America/Sao_Paulo';
  v_ate timestamptz := least(((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo', now());
  v_h numeric;
  v_veiculos jsonb;
  v_resumo jsonb;
  v_demanda jsonb;
  v_pico record;
begin
  if not app.tem_perfil(p_empresa, array['admin','gestor_frota','gestor_base','financeiro']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_fim < p_inicio or p_fim - p_inicio > 366 then raise exception 'periodo_invalido' using errcode = 'P0001'; end if;
  v_h := greatest(app.horas_no_periodo(v_de, v_ate, v_de, v_ate), 0.0001);

  drop table if exists _v; drop table if exists _r; drop table if exists _parado;
  -- Veículos do escopo (tabelas temporárias: a função é volátil por isso)
  create temp table _v on commit drop as
    select v.id, v.placa, v.modelo, c.nome as categoria, b.nome as base, b.unidade_id
    from public.veiculos v join public.bases b on b.id = v.base_id join public.categorias c on c.id = v.categoria_id
    where v.empresa_id = p_empresa and v.status <> 'inativo'
      and (p_unidade is null or b.unidade_id = p_unidade)
      and app.ve_no_relatorio(p_empresa, b.unidade_id);

  create temp table _r on commit drop as
    select u.* from app.uso_real u
    where u.empresa_id = p_empresa and u.veiculo_id in (select id from _v)
      and u.inicio < v_ate and coalesce(u.devolucao, u.fim) > v_de;

  -- Tempo fora de operação: ordens de serviço e incidentes, sem contar sobreposição duas vezes
  create temp table _parado on commit drop as
    select veiculo_id, sum(app.horas_no_periodo(lower(f), upper(f), v_de, v_ate)) as horas
    from (
      select veiculo_id, unnest(range_agg(tstzrange(ini, fim))) as f
      from (
        select o.veiculo_id, o.criado_em as ini, coalesce(o.concluida_em, now()) as fim
        from public.ordens_de_servico o where o.veiculo_id in (select id from _v)
        union all
        select i.veiculo_id, i.registrada_em, coalesce(i.encerrada_em, now())
        from public.incidentes i where i.veiculo_id in (select id from _v)
      ) x where fim > ini
      group by veiculo_id
    ) y group by veiculo_id;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.utilizacao_pct desc, t.placa), '[]'::jsonb) into v_veiculos
  from (
    select v.placa, v.modelo, v.categoria, v.base,
      round(coalesce(p.horas, 0), 1) as parado_h,
      round(coalesce((select sum(app.horas_no_periodo(r.inicio, r.fim, v_de, v_ate)) from _r r
                      where r.veiculo_id = v.id and r.status not in ('solicitada','cancelada','recusada')), 0), 1) as reservado_h,
      round(coalesce((select sum(app.horas_no_periodo(r.retirada, r.devolucao, v_de, v_ate)) from _r r
                      where r.veiculo_id = v.id and r.retirada is not null), 0), 1) as usado_h,
      coalesce((select sum(r.km) from _r r where r.veiculo_id = v.id and r.retirada >= v_de), 0) as km,
      (select count(*) from _r r where r.veiculo_id = v.id and r.retirada is not null and r.retirada >= v_de) as viagens,
      round(100 * coalesce((select sum(app.horas_no_periodo(r.retirada, r.devolucao, v_de, v_ate)) from _r r
                      where r.veiculo_id = v.id and r.retirada is not null), 0) / greatest(v_h - coalesce(p.horas, 0), 0.0001), 1) as utilizacao_pct,
      round(100 * coalesce((select sum(app.horas_no_periodo(r.inicio, r.fim, v_de, v_ate)) from _r r
                      where r.veiculo_id = v.id and r.status not in ('solicitada','cancelada','recusada')), 0) / greatest(v_h - coalesce(p.horas, 0), 0.0001), 1) as ocupacao_pct
    from _v v left join _parado p on p.veiculo_id = v.id
  ) t;

  -- Pico de reservas simultâneas no período
  select coalesce(max(simultaneas), 0) as n, (array_agg(quando order by simultaneas desc, quando))[1] as quando into v_pico
  from (
    select quando, sum(delta) over (order by quando, delta) as simultaneas
    from (
      select greatest(inicio, v_de) as quando, 1 as delta from _r where status not in ('solicitada','cancelada','recusada') and inicio < v_ate and fim > v_de
      union all
      select least(fim, v_ate), -1 from _r where status not in ('solicitada','cancelada','recusada') and inicio < v_ate and fim > v_de
    ) pontos
  ) s;

  select jsonb_build_object(
    'total', count(*),
    'pessoas', count(distinct d.user_id),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', coalesce(x.nome, 'Qualquer'), 'buscas', x.n) order by x.n desc)
                      from (select c.nome, count(*) as n from public.demandas_nao_atendidas d2
                            left join public.categorias c on c.id = d2.categoria_id
                            where d2.empresa_id = p_empresa and d2.inicio < v_ate and d2.fim > v_de
                              and (d2.base_id is null or d2.base_id in (select b.id from public.bases b join _v on _v.unidade_id = b.unidade_id))
                            group by c.nome) x), '[]'::jsonb))
  into v_demanda
  from public.demandas_nao_atendidas d
  where d.empresa_id = p_empresa and d.inicio < v_ate and d.fim > v_de
    and (d.base_id is null or d.base_id in (select b.id from public.bases b join _v on _v.unidade_id = b.unidade_id));

  select jsonb_build_object(
    'frota', (select count(*) from _v),
    'horas_periodo', round(v_h, 1),
    'utilizacao_pct', round(100 * coalesce((select sum(app.horas_no_periodo(retirada, devolucao, v_de, v_ate)) from _r where retirada is not null), 0)
                        / greatest((select count(*) from _v) * v_h - coalesce((select sum(horas) from _parado), 0), 0.0001), 1),
    'ocupacao_pct', round(100 * coalesce((select sum(app.horas_no_periodo(inicio, fim, v_de, v_ate)) from _r where status not in ('solicitada','cancelada','recusada')), 0)
                        / greatest((select count(*) from _v) * v_h - coalesce((select sum(horas) from _parado), 0), 0.0001), 1),
    'disponibilidade_pct', round(100 * (1 - coalesce((select sum(horas) from _parado), 0) / greatest((select count(*) from _v) * v_h, 0.0001)), 1),
    'reservas', (select count(*) from _r where inicio >= v_de and status not in ('solicitada','recusada')),
    'usadas', (select count(*) from _r where inicio >= v_de and retirada is not null),
    'no_show', (select count(*) from _r where inicio >= v_de and status = 'no_show'),
    'canceladas', (select count(*) from _r where inicio >= v_de and status = 'cancelada'),
    'cancelamentos_tardios', (select count(*) from _r r where r.inicio >= v_de and exists (
        select 1 from public.eventos_da_reserva e where e.reserva_id = r.reserva_id and e.para_status = 'cancelada' and e.detalhe ->> 'cancelamento_tardio' = 'true')),
    'atrasadas', (select count(*) from _r where inicio >= v_de and retirada is not null and atrasou),
    'atraso_medio_min', (select round(avg(extract(epoch from (devolucao - fim)) / 60)) from _r
                         where inicio >= v_de and atrasou and devolucao > fim and status in ('devolvida','encerrada')),
    'km', coalesce((select sum(km) from _r where retirada >= v_de), 0),
    'incidentes', (select count(*) from public.incidentes i where i.veiculo_id in (select id from _v) and i.registrada_em >= v_de and i.registrada_em < v_ate),
    'pico', v_pico.n,
    'pico_em', v_pico.quando
  ) into v_resumo;

  return jsonb_build_object('resumo', v_resumo, 'veiculos', v_veiculos, 'demanda', v_demanda,
                            'de', v_de, 'ate', v_ate);
end;
$$;

-- Lista de reservas para o financeiro (CSV por centro de custo)
create or replace function public.relatorio_reservas(p_empresa uuid, p_inicio date, p_fim date, p_unidade uuid default null)
returns table (
  data date, motorista text, placa text, modelo text, categoria text, base text, centro_de_custo text,
  finalidade text, destino text, inicio timestamptz, fim timestamptz, retirada timestamptz, devolucao timestamptz,
  horas_usadas numeric, km int, situacao text, atrasou boolean
) language plpgsql stable security definer set search_path = ''
as $$
declare
  v_de timestamptz := (p_inicio::timestamp) at time zone 'America/Sao_Paulo';
  v_ate timestamptz := ((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo';
begin
  if not app.tem_perfil(p_empresa, array['admin','gestor_frota','gestor_base','financeiro']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_fim < p_inicio or p_fim - p_inicio > 366 then raise exception 'periodo_invalido' using errcode = 'P0001'; end if;
  return query
    select (u.inicio at time zone 'America/Sao_Paulo')::date, m.nome, v.placa, v.modelo, c.nome, b.nome,
           coalesce(nullif(trim(u.centro_de_custo), ''), 'Sem centro de custo'), u.finalidade, u.destino,
           u.inicio, u.fim, u.retirada, case when u.status in ('devolvida','encerrada') then u.devolucao end,
           round(case when u.retirada is not null then extract(epoch from (u.devolucao - u.retirada)) / 3600 end::numeric, 1),
           u.km, u.status::text, u.atrasou
    from app.uso_real u
    join public.veiculos v on v.id = u.veiculo_id
    join public.bases b on b.id = v.base_id
    join public.categorias c on c.id = v.categoria_id
    left join lateral (select mm.nome from public.membros mm where mm.user_id = u.motorista_id and mm.empresa_id = u.empresa_id limit 1) m on true
    where u.empresa_id = p_empresa and u.inicio >= v_de and u.inicio < v_ate
      and u.status not in ('solicitada', 'recusada')
      and (p_unidade is null or b.unidade_id = p_unidade)
      and app.ve_no_relatorio(p_empresa, b.unidade_id)
    order by u.inicio;
end;
$$;

revoke all on function app.horas_no_periodo(timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.relatorio_frota(uuid, date, date, uuid) from public, anon;
revoke all on function public.relatorio_reservas(uuid, date, date, uuid) from public, anon;
grant execute on function public.relatorio_frota(uuid, date, date, uuid) to authenticated;
grant execute on function public.relatorio_reservas(uuid, date, date, uuid) to authenticated;
revoke all on app.uso_real from public, anon, authenticated;

-- Índices usados pelos relatórios
create index if not exists eventos_da_reserva_para_status_idx on public.eventos_da_reserva (reserva_id, para_status);
create index if not exists reservas_veiculo_inicio_idx on public.reservas (veiculo_id, inicio);
create index if not exists incidentes_veiculo_registrada_idx on public.incidentes (veiculo_id, registrada_em);

-- Central da portaria em tempo real: mudanças em reservas e incidentes chegam pelo Realtime (respeita a RLS)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservas') then
      alter publication supabase_realtime add table public.reservas;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incidentes') then
      alter publication supabase_realtime add table public.incidentes;
    end if;
  end if;
end $$;
