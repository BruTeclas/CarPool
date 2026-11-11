-- Sprint 4 · chave com identificador opaco, retirada, vistorias com fotos, avarias e manutenção

create type public.tipo_vistoria as enum ('saida', 'chegada');

-- Código que o motorista informa na portaria para a entrega manual da chave
alter table public.reservas
  add column codigo_retirada text not null default lpad(floor(random() * 1000000)::int::text, 6, '0');

-- Chave: o código do QR é opaco (não traz placa nem dado do carro)
create table public.chaves (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null unique references public.veiculos(id) on delete cascade,
  codigo text not null unique default replace(gen_random_uuid()::text, '-', ''),
  criado_em timestamptz not null default now()
);
create index on public.chaves (empresa_id);

create or replace function app.criar_chave()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.chaves (empresa_id, veiculo_id) values (new.empresa_id, new.id);
  return new;
end;
$$;
revoke all on function app.criar_chave() from public, anon, authenticated;
create trigger veiculos_criar_chave after insert on public.veiculos
  for each row execute function app.criar_chave();
insert into public.chaves (empresa_id, veiculo_id) select empresa_id, id from public.veiculos;

create table public.vistorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos(id),
  tipo public.tipo_vistoria not null,
  autor_id uuid not null references auth.users(id),
  odometro_km int not null check (odometro_km >= 0),
  combustivel_pct int not null check (combustivel_pct between 0 and 100),
  observacoes text,
  criado_em timestamptz not null default now(),
  unique (reserva_id, tipo)
);
create index on public.vistorias (empresa_id);
create index on public.vistorias (veiculo_id);
create index on public.vistorias (autor_id);

create table public.itens_de_vistoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vistoria_id uuid not null references public.vistorias(id) on delete cascade,
  item text not null,
  critico boolean not null default false,
  ok boolean not null,
  observacao text
);
create index on public.itens_de_vistoria (vistoria_id);
create index on public.itens_de_vistoria (empresa_id);

create table public.fotos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vistoria_id uuid not null references public.vistorias(id) on delete cascade,
  posicao text not null,
  caminho text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tirada_em timestamptz not null,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index on public.fotos (vistoria_id);
create index on public.fotos (empresa_id);

create table public.avarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos(id),
  reserva_id uuid references public.reservas(id) on delete set null,
  vistoria_id uuid references public.vistorias(id) on delete set null,
  responsavel_id uuid references auth.users(id) on delete set null,
  descricao text not null,
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  criado_em timestamptz not null default now()
);
create index on public.avarias (empresa_id, status);
create index on public.avarias (veiculo_id);
create index on public.avarias (reserva_id);
create index on public.avarias (vistoria_id);
create index on public.avarias (responsavel_id);

create table public.ocorrencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  reserva_id uuid references public.reservas(id) on delete set null,
  veiculo_id uuid references public.veiculos(id) on delete set null,
  autor_id uuid references auth.users(id) on delete set null,
  tipo text not null,
  descricao text,
  criado_em timestamptz not null default now()
);
create index on public.ocorrencias (empresa_id, criado_em desc);
create index on public.ocorrencias (reserva_id);
create index on public.ocorrencias (veiculo_id);
create index on public.ocorrencias (autor_id);

create table public.ordens_de_servico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos(id),
  vistoria_id uuid references public.vistorias(id) on delete set null,
  descricao text not null,
  status text not null default 'aberta' check (status in ('aberta', 'concluida')),
  criado_em timestamptz not null default now(),
  concluida_em timestamptz
);
create index on public.ordens_de_servico (empresa_id, status);
create index on public.ordens_de_servico (veiculo_id);
create index on public.ordens_de_servico (vistoria_id);

-- RLS: leitura por perfil; escrita só pelas funções (exceto resolver avaria, pela gestão)
alter table public.chaves enable row level security;
alter table public.vistorias enable row level security;
alter table public.itens_de_vistoria enable row level security;
alter table public.fotos enable row level security;
alter table public.avarias enable row level security;
alter table public.ocorrencias enable row level security;
alter table public.ordens_de_servico enable row level security;

revoke all on public.chaves, public.vistorias, public.itens_de_vistoria, public.fotos,
  public.avarias, public.ocorrencias, public.ordens_de_servico from anon, authenticated;
grant select on public.chaves, public.vistorias, public.itens_de_vistoria, public.fotos,
  public.avarias, public.ocorrencias, public.ordens_de_servico to authenticated;
grant update (status) on public.avarias to authenticated;

create policy chaves_select on public.chaves for select to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));
create policy vistorias_select on public.vistorias for select to authenticated
  using (exists (select 1 from public.reservas r where r.id = reserva_id));
create policy itens_select on public.itens_de_vistoria for select to authenticated
  using (exists (select 1 from public.vistorias v where v.id = vistoria_id));
create policy fotos_select on public.fotos for select to authenticated
  using (exists (select 1 from public.vistorias v where v.id = vistoria_id));
create policy avarias_select on public.avarias for select to authenticated
  using (responsavel_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));
create policy avarias_update on public.avarias for update to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy ocorrencias_select on public.ocorrencias for select to authenticated
  using (autor_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));
create policy os_select on public.ordens_de_servico for select to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));

create trigger auditar_avarias after insert or update or delete on public.avarias
  for each row execute function app.auditar();
create trigger auditar_os after insert or update or delete on public.ordens_de_servico
  for each row execute function app.auditar();

-- Fotos: bucket privado; caminho = <empresa>/<reserva>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vistorias', 'vistorias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy vistorias_fotos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vistorias'
    and (storage.foldername(name))[1] in (select e::text from app.empresas_do_usuario() e)
    and exists (select 1 from public.reservas r where r.id::text = (storage.foldername(name))[2])
  );
create policy vistorias_fotos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'vistorias'
    and exists (select 1 from public.reservas r where r.id::text = (storage.foldername(name))[2])
  );

-- Checklist padrão (itens críticos bloqueiam o veículo se reprovados)
create or replace function public.checklist_padrao()
returns table (item text, critico boolean, ordem int)
language sql immutable set search_path = ''
as $$
  values ('Pneus', true, 1), ('Freios', true, 2), ('Luzes e setas', true, 3),
         ('Limpadores de para-brisa', false, 4), ('Retrovisores', false, 5),
         ('Lataria e vidros', false, 6), ('Limpeza interna', false, 7),
         ('Estepe e ferramentas', false, 8), ('Documento do veículo', false, 9)
$$;

-- Mudança de estado interna (usada pelas funções abaixo; não é exposta)
create or replace function app.mudar_status(p_reserva uuid, p_para public.status_reserva, p_detalhe jsonb)
returns public.reservas language plpgsql security definer set search_path = ''
as $$
declare v_res public.reservas; v_de public.status_reserva;
begin
  select status into v_de from public.reservas where id = p_reserva for update;
  update public.reservas set status = p_para where id = p_reserva returning * into v_res;
  perform app.registrar_evento(v_res, v_de, p_detalhe);
  return v_res;
end;
$$;
revoke all on function app.mudar_status(uuid, public.status_reserva, jsonb) from public, anon, authenticated;

-- Quem lê o QR sem estar logado vê só o mínimo
create or replace function public.ficha_veiculo(p_codigo text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('modelo', v.modelo, 'base', b.nome)
  from public.chaves c
  join public.veiculos v on v.id = c.veiculo_id
  join public.bases b on b.id = v.base_id
  where c.codigo = p_codigo
$$;

-- Leitura da chave pelo motorista logado
create or replace function public.ler_chave(p_codigo text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ch public.chaves;
  v_ve public.veiculos;
  v_res public.reservas;
  v_outra record;
  v_cfg jsonb;
  v_base jsonb;
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;

  select * into v_ch from public.chaves where codigo = p_codigo;
  if not found or v_ch.empresa_id not in (select app.empresas_do_usuario()) then
    return jsonb_build_object('resultado', 'chave_desconhecida');
  end if;
  select * into v_ve from public.veiculos where id = v_ch.veiculo_id;
  v_base := jsonb_build_object('placa', v_ve.placa, 'modelo', v_ve.modelo);

  select * into v_res from public.reservas
   where veiculo_id = v_ve.id and motorista_id = v_uid and status in ('em_uso', 'atrasada')
   order by inicio limit 1;
  if found then
    return v_base || jsonb_build_object('resultado', 'devolucao', 'reserva_id', v_res.id);
  end if;

  select * into v_res from public.reservas
   where veiculo_id = v_ve.id and motorista_id = v_uid and status = 'liberada'
   order by inicio limit 1;
  if found then
    return v_base || jsonb_build_object('resultado', 'chave_certa', 'reserva_id', v_res.id);
  end if;

  select * into v_res from public.reservas
   where veiculo_id = v_ve.id and motorista_id = v_uid and status = 'aprovada' and fim > now()
   order by inicio limit 1;
  if found then
    v_cfg := app.politica_efetiva(v_res.empresa_id, v_uid, v_ve.base_id);
    if now() < v_res.inicio - interval '15 minutes' then
      return v_base || jsonb_build_object('resultado', 'antes_da_janela', 'reserva_id', v_res.id, 'inicio', v_res.inicio);
    end if;
    if now() > v_res.inicio + make_interval(mins => (v_cfg ->> 'tolerancia_noshow_min')::int) then
      perform app.mudar_status(v_res.id, 'no_show', '{"origem":"leitura_fora_da_tolerancia"}'::jsonb);
      return v_base || jsonb_build_object('resultado', 'fora_da_janela', 'reserva_id', v_res.id);
    end if;
    if not exists (select 1 from public.cnhs c
                   where c.user_id = v_uid and c.empresa_id = v_res.empresa_id
                     and c.validade >= (now() at time zone 'America/Sao_Paulo')::date) then
      return v_base || jsonb_build_object('resultado', 'cnh_invalida', 'reserva_id', v_res.id);
    end if;
    if v_ve.status <> 'ativo' then
      return v_base || jsonb_build_object('resultado', 'veiculo_bloqueado', 'reserva_id', v_res.id);
    end if;
    perform app.mudar_status(v_res.id, 'liberada', '{"via":"qr"}'::jsonb);
    return v_base || jsonb_build_object('resultado', 'chave_certa', 'reserva_id', v_res.id);
  end if;

  select r.id, v.placa, v.modelo into v_outra
  from public.reservas r join public.veiculos v on v.id = r.veiculo_id
  where r.motorista_id = v_uid and r.status in ('aprovada', 'liberada') and r.veiculo_id <> v_ve.id
    and now() between r.inicio - interval '60 minutes' and r.fim
  order by r.inicio limit 1;
  if found then
    insert into public.ocorrencias (empresa_id, reserva_id, veiculo_id, autor_id, tipo, descricao)
    values (v_ve.empresa_id, v_outra.id, v_ve.id, v_uid, 'chave_errada',
            'Leu a chave de ' || v_ve.placa || ' tendo reserva para ' || v_outra.placa);
    return jsonb_build_object('resultado', 'chave_errada', 'reserva_id', v_outra.id,
                              'placa', v_outra.placa, 'modelo', v_outra.modelo);
  end if;

  return v_base || jsonb_build_object('resultado', 'sem_reserva',
    'livre_agora', v_ve.status = 'ativo' and not exists (
      select 1 from public.reservas r
      where r.veiculo_id = v_ve.id and r.status in ('aprovada', 'liberada', 'em_uso', 'atrasada')
        and tstzrange(r.inicio, r.bloqueio_fim) && tstzrange(now(), now() + interval '2 hours')));
end;
$$;

-- Vistoria de saída ou de chegada, com checklist e fotos obrigatórias
create or replace function public.registrar_vistoria(
  p_reserva uuid, p_tipo public.tipo_vistoria, p_odometro int, p_combustivel int,
  p_itens jsonb, p_fotos jsonb, p_observacoes text default null, p_avarias jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.reservas;
  v_ve public.veiculos;
  v_vis uuid;
  v_saida public.vistorias;
  v_obrig text[] := array['frente', 'traseira', 'lateral_esquerda', 'lateral_direita', 'painel'];
  v_pos text;
  v_prefixo text;
  v_reprovados text;
  v_critico boolean;
  v_n int := 0;
  v_m int;
  v_txt text;
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;
  select * into v_res from public.reservas where id = p_reserva for update;
  if not found or v_res.empresa_id not in (select app.empresas_do_usuario()) then
    raise exception 'reserva_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_res.motorista_id <> v_uid and not app.tem_perfil(v_res.empresa_id,
       array['admin','gestor_frota','gestor_base']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if (p_tipo = 'saida' and v_res.status <> 'liberada')
     or (p_tipo = 'chegada' and v_res.status not in ('em_uso', 'atrasada')) then
    raise exception 'vistoria_fora_de_hora' using errcode = 'P0001';
  end if;

  select * into v_ve from public.veiculos where id = v_res.veiculo_id for update;
  if p_odometro is null or p_odometro < v_ve.odometro_km then
    raise exception 'odometro_invalido' using errcode = 'P0001';
  end if;
  if p_combustivel is null or p_combustivel not between 0 and 100 then
    raise exception 'combustivel_invalido' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'checklist_obrigatorio' using errcode = 'P0001';
  end if;

  if p_tipo = 'chegada' then v_obrig := v_obrig || array['vaga']; end if;
  v_prefixo := v_res.empresa_id::text || '/' || v_res.id::text || '/';
  foreach v_pos in array v_obrig loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
      join storage.objects o on o.bucket_id = 'vistorias' and o.name = f ->> 'caminho'
      where f ->> 'posicao' = v_pos and starts_with(f ->> 'caminho', v_prefixo)
    ) then
      raise exception 'fotos_obrigatorias_faltando' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.vistorias (empresa_id, reserva_id, veiculo_id, tipo, autor_id, odometro_km, combustivel_pct, observacoes)
  values (v_res.empresa_id, v_res.id, v_ve.id, p_tipo, v_uid, p_odometro, p_combustivel, nullif(trim(p_observacoes), ''))
  returning id into v_vis;

  -- "crítico" vem do checklist do servidor, não do que o cliente enviou
  insert into public.itens_de_vistoria (empresa_id, vistoria_id, item, critico, ok, observacao)
  select v_res.empresa_id, v_vis, i ->> 'item', coalesce(c.critico, false),
         coalesce((i ->> 'ok')::boolean, false), nullif(trim(i ->> 'observacao'), '')
  from jsonb_array_elements(p_itens) i
  left join public.checklist_padrao() c on c.item = i ->> 'item';

  insert into public.fotos (empresa_id, vistoria_id, posicao, caminho, sha256, tirada_em, latitude, longitude)
  select v_res.empresa_id, v_vis, f ->> 'posicao', f ->> 'caminho', f ->> 'sha256',
         coalesce((f ->> 'tirada_em')::timestamptz, now()),
         (f ->> 'latitude')::double precision, (f ->> 'longitude')::double precision
  from jsonb_array_elements(p_fotos) f
  where starts_with(f ->> 'caminho', v_prefixo);

  update public.veiculos set odometro_km = p_odometro where id = v_ve.id;

  select string_agg(item, ', ') into v_reprovados
  from public.itens_de_vistoria where vistoria_id = v_vis and critico and not ok;
  v_critico := v_reprovados is not null;
  if v_critico then
    update public.veiculos set status = 'bloqueado' where id = v_ve.id;
    insert into public.ordens_de_servico (empresa_id, veiculo_id, vistoria_id, descricao)
    values (v_res.empresa_id, v_ve.id, v_vis, 'Item crítico reprovado na vistoria: ' || v_reprovados);
  end if;

  if p_tipo = 'saida' then
    if v_critico then
      perform app.mudar_status(v_res.id, 'cancelada', '{"motivo":"falha_critica_no_checklist"}'::jsonb);
      return jsonb_build_object('resultado', 'veiculo_bloqueado', 'itens', v_reprovados);
    end if;
    perform app.mudar_status(v_res.id, 'em_uso', '{"via":"vistoria_de_saida"}'::jsonb);
    return jsonb_build_object('resultado', 'em_uso');
  end if;

  -- Chegada: compara com a saída
  select * into v_saida from public.vistorias where reserva_id = v_res.id and tipo = 'saida';
  insert into public.avarias (empresa_id, veiculo_id, reserva_id, vistoria_id, responsavel_id, descricao)
  select v_res.empresa_id, v_ve.id, v_res.id, v_vis, v_res.motorista_id,
         'Item aprovado na saída e reprovado na chegada: ' || c.item
         || coalesce(' (' || c.observacao || ')', '')
  from public.itens_de_vistoria c
  join public.itens_de_vistoria s on s.item = c.item and s.vistoria_id = v_saida.id
  where c.vistoria_id = v_vis and s.ok and not c.ok;
  get diagnostics v_n = row_count;

  for v_txt in select trim(a) from jsonb_array_elements_text(coalesce(p_avarias, '[]'::jsonb)) a loop
    if v_txt <> '' then
      insert into public.avarias (empresa_id, veiculo_id, reserva_id, vistoria_id, responsavel_id, descricao)
      values (v_res.empresa_id, v_ve.id, v_res.id, v_vis, v_res.motorista_id, v_txt);
      v_n := v_n + 1;
    end if;
  end loop;

  if v_saida.id is not null and p_combustivel < v_saida.combustivel_pct then
    insert into public.ocorrencias (empresa_id, reserva_id, veiculo_id, autor_id, tipo, descricao)
    values (v_res.empresa_id, v_res.id, v_ve.id, v_uid, 'combustivel_abaixo',
            'Saiu com ' || v_saida.combustivel_pct || '% e voltou com ' || p_combustivel || '%');
  end if;

  v_m := p_odometro - coalesce(v_saida.odometro_km, p_odometro);
  perform app.mudar_status(v_res.id, 'devolvida', jsonb_build_object('avarias', v_n, 'km_rodados', v_m));
  if v_n = 0 and not v_critico then
    perform app.mudar_status(v_res.id, 'encerrada', '{"automatico":true}'::jsonb);
    return jsonb_build_object('resultado', 'encerrada', 'km_rodados', v_m);
  end if;
  return jsonb_build_object('resultado', 'devolvida', 'avarias', v_n, 'bloqueado', v_critico, 'km_rodados', v_m);
end;
$$;

-- Manutenção conclui a ordem; sem outra ordem aberta, o veículo volta a ficar ativo
create or replace function public.concluir_ordem(p_ordem uuid)
returns public.ordens_de_servico language plpgsql security definer set search_path = ''
as $$
declare v_os public.ordens_de_servico;
begin
  select * into v_os from public.ordens_de_servico where id = p_ordem for update;
  if not found or not app.tem_perfil(v_os.empresa_id, array['admin','gestor_frota']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update public.ordens_de_servico set status = 'concluida', concluida_em = now()
   where id = p_ordem returning * into v_os;
  if not exists (select 1 from public.ordens_de_servico o where o.veiculo_id = v_os.veiculo_id and o.status = 'aberta') then
    update public.veiculos set status = 'ativo' where id = v_os.veiculo_id and status = 'bloqueado';
  end if;
  return v_os;
end;
$$;

revoke all on function public.checklist_padrao() from public, anon;
revoke all on function public.ficha_veiculo(text) from public;
revoke all on function public.ler_chave(text) from public, anon;
revoke all on function public.registrar_vistoria(uuid, public.tipo_vistoria, int, int, jsonb, jsonb, text, jsonb) from public, anon;
revoke all on function public.concluir_ordem(uuid) from public, anon;
grant execute on function public.checklist_padrao() to authenticated;
grant execute on function public.ficha_veiculo(text) to anon, authenticated;
grant execute on function public.ler_chave(text) to authenticated;
grant execute on function public.registrar_vistoria(uuid, public.tipo_vistoria, int, int, jsonb, jsonb, text, jsonb) to authenticated;
grant execute on function public.concluir_ordem(uuid) to authenticated;
