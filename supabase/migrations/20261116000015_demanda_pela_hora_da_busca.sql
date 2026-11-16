-- Sprint 6 · demanda não atendida conta pela hora em que a busca foi feita (inclui buscas para horários futuros)
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
                            where d2.empresa_id = p_empresa and d2.em >= v_de and d2.em < v_ate
                              and (d2.base_id is null or d2.base_id in (select b.id from public.bases b join _v on _v.unidade_id = b.unidade_id))
                            group by c.nome) x), '[]'::jsonb))
  into v_demanda
  from public.demandas_nao_atendidas d
  where d.empresa_id = p_empresa and d.em >= v_de and d.em < v_ate
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

