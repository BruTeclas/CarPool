-- Sprint 4B · Documentos (condutor e veículo) com conferência e vencimento; termos de uso com assinatura

alter table public.empresas add column aviso_vencimento_dias int not null default 30 check (aviso_vencimento_dias between 1 and 365);

create table public.tipos_de_documento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  alvo text not null check (alvo in ('condutor', 'veiculo')),
  obrigatorio boolean not null default true,
  tem_validade boolean not null default true,
  e_cnh boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);
create index on public.tipos_de_documento (empresa_id);
create unique index tipos_uma_cnh_por_empresa on public.tipos_de_documento (empresa_id) where e_cnh;

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo_id uuid not null references public.tipos_de_documento(id),
  user_id uuid references auth.users(id) on delete cascade,
  veiculo_id uuid references public.veiculos(id) on delete cascade,
  numero text,
  categoria_cnh text check (categoria_cnh is null or categoria_cnh ~ '^[A-E]{1,2}$'),
  validade date,
  caminho text not null,
  nome_arquivo text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  motivo_recusa text,
  enviado_por uuid references auth.users(id) on delete set null,
  enviado_em timestamptz not null default now(),
  conferido_por uuid references auth.users(id) on delete set null,
  conferido_em timestamptz,
  check ((user_id is null) <> (veiculo_id is null))
);
create index on public.documentos (empresa_id, status);
create index on public.documentos (tipo_id);
create index on public.documentos (user_id);
create index on public.documentos (veiculo_id);
create index on public.documentos (enviado_por);
create index on public.documentos (conferido_por);

create table public.termos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) > 0),
  texto text not null check (length(trim(texto)) > 0),
  versao int not null check (versao > 0),
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (empresa_id, titulo, versao)
);
create index on public.termos (empresa_id) where ativo;
create index on public.termos (criado_por);

create table public.assinaturas_de_termo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  termo_id uuid not null references public.termos(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome_assinante text not null check (length(trim(nome_assinante)) > 2),
  texto_sha256 text not null,
  assinatura_caminho text not null,
  assinatura_sha256 text not null,
  ip text,
  navegador text,
  assinado_em timestamptz not null default now(),
  unique (termo_id, user_id)
);
create index on public.assinaturas_de_termo (empresa_id);
create index on public.assinaturas_de_termo (user_id);

-- Texto do termo e assinatura não mudam depois de gravados
create or replace function app.termo_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.texto is distinct from old.texto or new.titulo is distinct from old.titulo or new.versao is distinct from old.versao then
    raise exception 'termo_imutavel' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger termos_imutavel before update on public.termos
  for each row execute function app.termo_imutavel();
create trigger assinaturas_sem_update before update on public.assinaturas_de_termo
  for each row execute function app.bloquear_alteracao();

-- Toda empresa nasce com o tipo CNH
create or replace function app.criar_tipo_cnh()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.tipos_de_documento (empresa_id, nome, alvo, obrigatorio, tem_validade, e_cnh)
  values (new.id, 'CNH', 'condutor', true, true, true) on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.criar_tipo_cnh() from public, anon, authenticated;
create trigger empresas_criar_tipo_cnh after insert on public.empresas
  for each row execute function app.criar_tipo_cnh();
insert into public.tipos_de_documento (empresa_id, nome, alvo, obrigatorio, tem_validade, e_cnh)
select id, 'CNH', 'condutor', true, true, true from public.empresas on conflict do nothing;

-- RLS: leitura por perfil; escrita de documentos e assinaturas só pelas funções
alter table public.tipos_de_documento enable row level security;
alter table public.documentos enable row level security;
alter table public.termos enable row level security;
alter table public.assinaturas_de_termo enable row level security;
revoke all on public.tipos_de_documento, public.documentos, public.termos, public.assinaturas_de_termo from anon;
revoke all on public.documentos, public.assinaturas_de_termo from authenticated;
grant select on public.documentos, public.assinaturas_de_termo to authenticated;

create policy tipos_doc_select on public.tipos_de_documento for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy tipos_doc_write on public.tipos_de_documento for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));
create policy documentos_select on public.documentos for select to authenticated
  using (user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[])
    or (veiculo_id is not null
        and app.tem_perfil(empresa_id, array['gestor_base']::public.perfil_membro[])
        and exists (select 1 from public.veiculos v where v.id = veiculo_id)));
create policy termos_select on public.termos for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy termos_insert on public.termos for insert to authenticated
  with check (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));
create policy termos_update on public.termos for update to authenticated
  using (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));
create policy assinaturas_select on public.assinaturas_de_termo for select to authenticated
  using (user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));

create trigger auditar_tipos_doc after insert or update or delete on public.tipos_de_documento
  for each row execute function app.auditar();
create trigger auditar_documentos after insert or update or delete on public.documentos
  for each row execute function app.auditar();
create trigger auditar_termos after insert or update or delete on public.termos
  for each row execute function app.auditar();

-- Arquivos: bucket privado; caminho = <empresa>/<pessoa ou veículo>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy documentos_arquivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and exists (select 1 from public.membros m
      where m.user_id = (select auth.uid()) and m.ativo and m.empresa_id::text = (storage.foldername(name))[1]
        and ((storage.foldername(name))[2] = (select auth.uid())::text or m.perfil in ('admin', 'gestor_frota')))
  );
create policy documentos_arquivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documentos'
    and exists (select 1 from public.membros m
      where m.user_id = (select auth.uid()) and m.ativo and m.empresa_id::text = (storage.foldername(name))[1]
        and ((storage.foldername(name))[2] = (select auth.uid())::text or m.perfil in ('admin', 'gestor_frota')
             or (m.perfil = 'gestor_base' and exists (select 1 from public.veiculos v where v.id::text = (storage.foldername(name))[2]))))
  );

-- Documento aprovado de CNH atualiza o cadastro usado nas reservas
create or replace function app.aplicar_cnh(p_doc public.documentos)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.tipos_de_documento t where t.id = p_doc.tipo_id and t.e_cnh) and p_doc.status = 'aprovado' then
    insert into public.cnhs (empresa_id, user_id, numero, categoria, validade, ultima_revalidacao)
    values (p_doc.empresa_id, p_doc.user_id, coalesce(p_doc.numero, ''), coalesce(p_doc.categoria_cnh, 'B'), p_doc.validade, current_date)
    on conflict (empresa_id, user_id) do update
      set numero = excluded.numero, categoria = excluded.categoria, validade = excluded.validade, ultima_revalidacao = current_date;
  end if;
end;
$$;
revoke all on function app.aplicar_cnh(public.documentos) from public, anon, authenticated;

create or replace function public.enviar_documento(
  p_tipo uuid, p_caminho text, p_nome_arquivo text default null, p_validade date default null,
  p_numero text default null, p_categoria_cnh text default null, p_user uuid default null, p_veiculo uuid default null
) returns public.documentos language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tipo public.tipos_de_documento;
  v_gestao boolean;
  v_user uuid;
  v_alvo text;
  v_doc public.documentos;
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;
  select * into v_tipo from public.tipos_de_documento
   where id = p_tipo and ativo and empresa_id in (select app.empresas_do_usuario());
  if not found then raise exception 'tipo_de_documento_invalido' using errcode = 'P0001'; end if;
  v_gestao := app.tem_perfil(v_tipo.empresa_id, array['admin','gestor_frota']::public.perfil_membro[]);

  if v_tipo.alvo = 'veiculo' then
    if not v_gestao then raise exception 'sem_permissao' using errcode = '42501'; end if;
    if p_veiculo is null or not exists (select 1 from public.veiculos v where v.id = p_veiculo and v.empresa_id = v_tipo.empresa_id) then
      raise exception 'veiculo_nao_encontrado' using errcode = 'P0002';
    end if;
    v_alvo := p_veiculo::text;
  else
    v_user := coalesce(p_user, v_uid);
    if v_user <> v_uid and not v_gestao then raise exception 'sem_permissao' using errcode = '42501'; end if;
    if not exists (select 1 from public.membros m where m.user_id = v_user and m.empresa_id = v_tipo.empresa_id and m.ativo) then
      raise exception 'motorista_fora_da_empresa' using errcode = 'P0001';
    end if;
    v_alvo := v_user::text;
  end if;

  if v_tipo.tem_validade and p_validade is null then raise exception 'validade_obrigatoria' using errcode = 'P0001'; end if;
  if p_validade is not null and p_validade < current_date then raise exception 'documento_vencido' using errcode = 'P0001'; end if;
  if v_tipo.e_cnh and (coalesce(trim(p_numero), '') = '' or p_categoria_cnh is null) then
    raise exception 'dados_da_cnh_obrigatorios' using errcode = 'P0001';
  end if;
  if not starts_with(p_caminho, v_tipo.empresa_id::text || '/' || v_alvo || '/')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = p_caminho) then
    raise exception 'arquivo_nao_encontrado' using errcode = 'P0001';
  end if;

  insert into public.documentos (empresa_id, tipo_id, user_id, veiculo_id, numero, categoria_cnh, validade, caminho, nome_arquivo,
    status, enviado_por, conferido_por, conferido_em)
  values (v_tipo.empresa_id, v_tipo.id, v_user, case when v_tipo.alvo = 'veiculo' then p_veiculo end,
    nullif(trim(p_numero), ''), p_categoria_cnh, case when v_tipo.tem_validade then p_validade end, p_caminho, p_nome_arquivo,
    -- enviado pela gestão já vale; enviado pelo próprio condutor espera a conferência
    case when v_gestao then 'aprovado' else 'pendente' end, v_uid,
    case when v_gestao then v_uid end, case when v_gestao then now() end)
  returning * into v_doc;
  perform app.aplicar_cnh(v_doc);
  return v_doc;
end;
$$;

create or replace function public.conferir_documento(p_documento uuid, p_aprovar boolean, p_motivo text default null)
returns public.documentos language plpgsql security definer set search_path = ''
as $$
declare v_doc public.documentos;
begin
  select * into v_doc from public.documentos where id = p_documento for update;
  if not found or not app.tem_perfil(v_doc.empresa_id, array['admin','gestor_frota']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_doc.status <> 'pendente' then raise exception 'documento_ja_conferido' using errcode = 'P0001'; end if;
  if not p_aprovar and coalesce(trim(p_motivo), '') = '' then raise exception 'motivo_obrigatorio' using errcode = 'P0001'; end if;
  update public.documentos
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         motivo_recusa = case when p_aprovar then null else trim(p_motivo) end,
         conferido_por = (select auth.uid()), conferido_em = now()
   where id = p_documento returning * into v_doc;
  perform app.aplicar_cnh(v_doc);
  return v_doc;
end;
$$;

-- Documento em vigor: o aprovado mais recente de cada tipo, por pessoa ou veículo
create or replace view app.documentos_em_vigor as
  select distinct on (d.tipo_id, d.user_id, d.veiculo_id) d.*
  from public.documentos d where d.status = 'aprovado'
  order by d.tipo_id, d.user_id, d.veiculo_id, d.enviado_em desc;

-- O que falta para uma pessoa poder dirigir até uma data (nomes dos tipos obrigatórios sem documento válido)
create or replace function app.documentos_faltando(p_empresa uuid, p_user uuid, p_veiculo uuid, p_ate date)
returns setof text language sql stable security definer set search_path = ''
as $$
  select t.nome from public.tipos_de_documento t
  where t.empresa_id = p_empresa and t.ativo and t.obrigatorio and not t.e_cnh
    and ((t.alvo = 'condutor' and p_user is not null) or (t.alvo = 'veiculo' and p_veiculo is not null))
    and not exists (
      select 1 from app.documentos_em_vigor d
      where d.tipo_id = t.id
        and ((t.alvo = 'condutor' and d.user_id = p_user) or (t.alvo = 'veiculo' and d.veiculo_id = p_veiculo))
        and (d.validade is null or d.validade >= p_ate))
  order by t.nome
$$;
revoke all on function app.documentos_faltando(uuid, uuid, uuid, date) from public, anon, authenticated;

create or replace function public.assinar_termo(p_termo uuid, p_nome text, p_assinatura_caminho text, p_assinatura_sha256 text)
returns public.assinaturas_de_termo language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_termo public.termos;
  v_ass public.assinaturas_de_termo;
  v_cab json := nullif(current_setting('request.headers', true), '')::json;
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;
  select * into v_termo from public.termos where id = p_termo and ativo and empresa_id in (select app.empresas_do_usuario());
  if not found then raise exception 'termo_nao_encontrado' using errcode = 'P0002'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'nome_obrigatorio' using errcode = 'P0001'; end if;
  if not starts_with(p_assinatura_caminho, v_termo.empresa_id::text || '/' || v_uid::text || '/')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = p_assinatura_caminho) then
    raise exception 'arquivo_nao_encontrado' using errcode = 'P0001';
  end if;
  insert into public.assinaturas_de_termo (empresa_id, termo_id, user_id, nome_assinante, texto_sha256,
    assinatura_caminho, assinatura_sha256, ip, navegador)
  values (v_termo.empresa_id, v_termo.id, v_uid, trim(p_nome),
    encode(sha256(convert_to(v_termo.texto, 'UTF8')), 'hex'), p_assinatura_caminho, p_assinatura_sha256,
    split_part(v_cab ->> 'x-forwarded-for', ',', 1), left(v_cab ->> 'user-agent', 300))
  returning * into v_ass;
  return v_ass;
exception when unique_violation then
  raise exception 'termo_ja_assinado' using errcode = 'P0001';
end;
$$;

-- Tudo o que impede a pessoa logada de reservar agora
create or replace function public.pendencias_para_reservar(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'termos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'versao', t.versao, 'texto', t.texto) order by t.titulo)
      from public.termos t
      where t.empresa_id = p_empresa and t.ativo
        and not exists (select 1 from public.assinaturas_de_termo a where a.termo_id = t.id and a.user_id = (select auth.uid()))), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(n) from app.documentos_faltando(p_empresa, (select auth.uid()), null, current_date) n), '[]'::jsonb),
    'cnh', not exists (select 1 from public.cnhs c where c.user_id = (select auth.uid()) and c.empresa_id = p_empresa and c.validade >= current_date)
  )
  where p_empresa in (select app.empresas_do_usuario())
$$;

-- Documentos que vencem dentro do prazo de aviso da empresa (ou já venceram)
create or replace function public.documentos_vencendo(p_empresa uuid, p_so_meus boolean default false)
returns table (documento_id uuid, tipo text, alvo text, pessoa text, placa text, validade date, dias int)
language sql stable security definer set search_path = ''
as $$
  select d.id, t.nome, t.alvo,
         (select m.nome from public.membros m where m.user_id = d.user_id and m.empresa_id = d.empresa_id limit 1),
         v.placa, d.validade, (d.validade - current_date)
  from app.documentos_em_vigor d
  join public.tipos_de_documento t on t.id = d.tipo_id and t.ativo
  left join public.veiculos v on v.id = d.veiculo_id
  join public.empresas e on e.id = d.empresa_id
  where d.empresa_id = p_empresa and p_empresa in (select app.empresas_do_usuario())
    and d.validade is not null and d.validade <= current_date + e.aviso_vencimento_dias
    and (d.user_id = (select auth.uid())
         or (not p_so_meus and app.tem_perfil(p_empresa, array['admin','gestor_frota']::public.perfil_membro[])))
  order by d.validade
$$;

-- Trava na reserva: termo assinado e documentos obrigatórios do condutor e do veículo
create or replace function app.conferir_documentos_da_reserva()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_falta text; v_ate date := (new.fim at time zone 'America/Sao_Paulo')::date;
begin
  if exists (select 1 from public.termos t where t.empresa_id = new.empresa_id and t.ativo
             and not exists (select 1 from public.assinaturas_de_termo a where a.termo_id = t.id and a.user_id = new.motorista_id)) then
    raise exception 'termo_nao_assinado' using errcode = 'P0001';
  end if;
  select string_agg(n, ', ') into v_falta from app.documentos_faltando(new.empresa_id, new.motorista_id, null, v_ate) n;
  if v_falta is not null then raise exception 'documento_pendente: %', v_falta using errcode = 'P0001'; end if;
  select string_agg(n, ', ') into v_falta from app.documentos_faltando(new.empresa_id, null, new.veiculo_id, v_ate) n;
  if v_falta is not null then raise exception 'veiculo_sem_documento: %', v_falta using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function app.conferir_documentos_da_reserva() from public, anon, authenticated;
create trigger reservas_conferir_documentos before insert on public.reservas
  for each row execute function app.conferir_documentos_da_reserva();

-- Veículo com documento obrigatório vencido ou faltando não aparece como disponível
create or replace function public.disponibilidade(
  p_inicio timestamptz, p_fim timestamptz,
  p_categoria uuid default null, p_base uuid default null
) returns table (veiculo_id uuid, placa text, modelo text, categoria_id uuid, base_id uuid, odometro_km int)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.placa, v.modelo, v.categoria_id, v.base_id, v.odometro_km
  from public.veiculos v
  join public.bases b on b.id = v.base_id
  where v.empresa_id in (select app.empresas_do_usuario())
    and b.unidade_id in (select app.unidades_do_usuario())
    and v.status = 'ativo'
    and (p_categoria is null or v.categoria_id = p_categoria)
    and (p_base is null or v.base_id = p_base)
    and not exists (select 1 from app.documentos_faltando(v.empresa_id, null, v.id, (p_fim at time zone 'America/Sao_Paulo')::date))
    and not exists (
      select 1 from public.reservas r
      where r.veiculo_id = v.id
        and r.status in ('aprovada', 'liberada', 'em_uso', 'atrasada')
        and tstzrange(r.inicio, r.bloqueio_fim) && tstzrange(p_inicio, p_fim + interval '30 minutes')
    )
  order by v.odometro_km asc, v.placa
$$;

revoke all on function public.enviar_documento(uuid, text, text, date, text, text, uuid, uuid) from public, anon;
revoke all on function public.conferir_documento(uuid, boolean, text) from public, anon;
revoke all on function public.assinar_termo(uuid, text, text, text) from public, anon;
revoke all on function public.pendencias_para_reservar(uuid) from public, anon;
revoke all on function public.documentos_vencendo(uuid, boolean) from public, anon;
grant execute on function public.enviar_documento(uuid, text, text, date, text, text, uuid, uuid) to authenticated;
grant execute on function public.conferir_documento(uuid, boolean, text) to authenticated;
grant execute on function public.assinar_termo(uuid, text, text, text) to authenticated;
grant execute on function public.pendencias_para_reservar(uuid) to authenticated;
grant execute on function public.documentos_vencendo(uuid, boolean) to authenticated;

-- Dois envios na mesma transação precisam de horários distintos para valer "o mais recente"
alter table public.documentos alter column enviado_em set default clock_timestamp();
