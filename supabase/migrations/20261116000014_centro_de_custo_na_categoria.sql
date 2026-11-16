-- Sprint 6 · a reserva por categoria também grava o centro de custo (relatório do financeiro)
drop function if exists public.criar_reserva_por_categoria(uuid, timestamptz, timestamptz, text, text, int, uuid);
create or replace function public.criar_reserva_por_categoria(
  p_categoria uuid, p_inicio timestamptz, p_fim timestamptz,
  p_finalidade text default null, p_destino text default null,
  p_passageiros int default 0, p_base uuid default null, p_centro_de_custo text default null
) returns public.reservas
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_res public.reservas;
begin
  for v in select d.veiculo_id from public.disponibilidade(p_inicio, p_fim, p_categoria, p_base) d loop
    begin
      v_res := public.criar_reserva(v.veiculo_id, p_inicio, p_fim, p_finalidade, p_destino, p_passageiros, null, p_centro_de_custo);
      return v_res;
    exception when others then
      if sqlerrm <> 'conflito_agenda' then raise; end if;
    end;
  end loop;
  raise exception 'sem_veiculo_disponivel' using errcode = 'P0001';
end;
$$;
revoke all on function public.criar_reserva_por_categoria(uuid, timestamptz, timestamptz, text, text, int, uuid, text) from public, anon;
grant execute on function public.criar_reserva_por_categoria(uuid, timestamptz, timestamptz, text, text, int, uuid, text) to authenticated;
