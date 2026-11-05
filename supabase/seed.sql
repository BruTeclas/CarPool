-- Seed de DESENVOLVIMENTO. Troque __SENHA__ por uma senha aleatória ao aplicar (nunca commitar a senha).
-- Duas empresas para provar o isolamento entre clientes.
do $$
declare
  v_ea uuid := '11111111-1111-1111-1111-111111111111';
  v_eb uuid := '22222222-2222-2222-2222-222222222222';
  v_uni_a uuid := gen_random_uuid();
  v_uni_b uuid := gen_random_uuid();
  v_base_a uuid := gen_random_uuid();
  v_base_b uuid := gen_random_uuid();
  u record;
  v_uid uuid;
begin
  insert into public.empresas (id, nome) values (v_ea, 'Empresa A (dev)'), (v_eb, 'Empresa B (dev)')
    on conflict do nothing;
  insert into public.unidades (id, empresa_id, nome) values (v_uni_a, v_ea, 'Matriz A'), (v_uni_b, v_eb, 'Matriz B');
  insert into public.bases (id, empresa_id, unidade_id, nome) values
    (v_base_a, v_ea, v_uni_a, 'Base São Paulo A'), (v_base_b, v_eb, v_uni_b, 'Base Campinas B');
  insert into public.vagas (empresa_id, base_id, codigo) values (v_ea, v_base_a, 'V01'), (v_eb, v_base_b, 'V01');

  for u in select * from (values
    ('admin.a@carpool.test', v_ea, 'admin'::public.perfil_membro, 'Admin A'),
    ('gestor.a@carpool.test', v_ea, 'gestor_frota', 'Gestor de frota A'),
    ('motorista.a@carpool.test', v_ea, 'motorista', 'Motorista A'),
    ('admin.b@carpool.test', v_eb, 'admin', 'Admin B'),
    ('motorista.b@carpool.test', v_eb, 'motorista', 'Motorista B')
  ) as t(email, empresa, perfil, nome)
  loop
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', u.email,
      extensions.crypt('__SENHA__', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now());
    insert into public.membros (empresa_id, user_id, perfil, nome) values (u.empresa, v_uid, u.perfil, u.nome);
  end loop;
end $$;
