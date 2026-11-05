-- Seed de DESENVOLVIMENTO da frota (rodar depois de seed.sql). Usa as empresas A e B do seed.
do $$
declare
  v_ea constant uuid := '11111111-1111-1111-1111-111111111111';
  v_eb constant uuid := '22222222-2222-2222-2222-222222222222';
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
begin
  insert into public.categorias (id, empresa_id, nome, cnh_minima) values
    (v_cat_a, v_ea, 'Sedan', 'B'), (v_cat_b, v_eb, 'Sedan', 'B');

  insert into public.veiculos (empresa_id, base_id, categoria_id, placa, modelo, ano, odometro_km) values
    (v_ea, (select id from public.bases where empresa_id = v_ea limit 1), v_cat_a, 'ABC1D23', 'Fiat Cronos', 2024, 12000),
    (v_ea, (select id from public.bases where empresa_id = v_ea limit 1), v_cat_a, 'EFG4H56', 'VW Polo', 2023, 30500),
    (v_eb, (select id from public.bases where empresa_id = v_eb limit 1), v_cat_b, 'XYZ9K87', 'Chevrolet Onix', 2024, 8000);

  insert into public.cnhs (empresa_id, user_id, numero, categoria, validade)
  select m.empresa_id, m.user_id, '0000000' || row_number() over (), 'B', date '2030-12-31'
  from public.membros m where m.perfil in ('motorista', 'gestor_frota');
end $$;
