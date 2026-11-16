-- Treinamentos e comunicados, parte 1: comunicados aos colaboradores.
-- O gestor dispara um comunicado (texto, imagem e botão de ação) para um público (perfis, grupos,
-- filial), com recorrência. Aparece como pop-up ao abrir o app e fica guardado em Avisos.
-- Níveis: informativo (registra a visualização), ciência (pede "Li e entendi") e bloqueante
-- (não reserva até dar ciência). Depois de enviado, o comunicado não muda; só pode ser encerrado.

create table public.comunicados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  texto text check (texto is null or length(texto) <= 5000),
  imagem_caminho text,
  acao_rotulo text check (acao_rotulo is null or length(trim(acao_rotulo)) between 1 and 40),
  acao_link text check (acao_link is null or acao_link ~ '^(https?://|/)'),
  -- público: nulo = sem filtro; os filtros se somam (ex.: motoristas da filial X)
  publico_perfis public.perfil_membro[],
  publico_grupos uuid[],
  unidade_id uuid references public.unidades(id) on delete cascade,
  nivel text not null default 'informativo' check (nivel in ('informativo', 'ciencia', 'bloqueante')),
  recorrencia text not null default 'unica' check (recorrencia in ('unica', 'diaria', 'semanal', 'mensal', 'anual', 'ate_confirmar')),
  inicio timestamptz not null default now(),
  fim timestamptz,
  janela_dias int check (janela_dias is null or janela_dias between 1 and 366),
  encerrado_em timestamptz,
  encerrado_por uuid references auth.users(id) on delete set null,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  check (fim is null or fim > inicio),
  check ((acao_rotulo is null) = (acao_link is null)),
  check (recorrencia <> 'ate_confirmar' or nivel <> 'informativo'),
  check (recorrencia <> 'anual' or janela_dias is not null),
  check (texto is not null or imagem_caminho is not null)
);
create index on public.comunicados (empresa_id, inicio desc);
create index on public.comunicados (unidade_id);
create index on public.comunicados (criado_por);
create index on public.comunicados (encerrado_por);

-- Uma linha por pessoa e por ocorrência (a data em que a repetição começou)
create table public.comunicado_leituras (
  comunicado_id uuid not null references public.comunicados(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ocorrencia date not null,
  visto_em timestamptz not null default now(),
  ciente_em timestamptz,
  primary key (comunicado_id, user_id, ocorrencia)
);
create index on public.comunicado_leituras (user_id);
create index on public.comunicado_leituras (empresa_id);

-- ---------------------------------------------------------------- regras
create or replace function app.comunicado_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'encerrado_em' - 'encerrado_por') is distinct from (to_jsonb(old) - 'encerrado_em' - 'encerrado_por') then
    raise exception 'comunicado_enviado_nao_muda' using errcode = 'P0001';
  end if;
  if old.encerrado_em is not null then raise exception 'comunicado_ja_encerrado' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger comunicados_imutavel before update on public.comunicados
  for each row execute function app.comunicado_imutavel();

-- Ocorrência em vigor agora (data local de início da repetição), ou nulo se o comunicado não está no ar
create or replace function app.comunicado_ocorrencia(c public.comunicados, p_agora timestamptz default now())
returns date language plpgsql stable set search_path = ''
as $$
declare
  t date := (p_agora at time zone 'America/Sao_Paulo')::date;
  d0 date := (c.inicio at time zone 'America/Sao_Paulo')::date;
  k int; v date;
begin
  if c.encerrado_em is not null or p_agora < c.inicio or (c.fim is not null and p_agora >= c.fim) then return null; end if;
  case c.recorrencia
    when 'unica', 'ate_confirmar' then v := d0;
    when 'diaria' then v := t;
    when 'semanal' then v := d0 + ((t - d0) / 7) * 7;
    when 'mensal' then
      k := (extract(year from t)::int - extract(year from d0)::int) * 12 + extract(month from t)::int - extract(month from d0)::int;
      if (d0 + make_interval(months => k))::date > t then k := k - 1; end if;
      v := (d0 + make_interval(months => k))::date;
    when 'anual' then
      k := extract(year from t)::int - extract(year from d0)::int;
      if (d0 + make_interval(years => k))::date > t then k := k - 1; end if;
      v := (d0 + make_interval(years => k))::date;
  end case;
  if c.janela_dias is not null and t >= v + c.janela_dias then return null; end if;
  return v;
end;
$$;

-- A pessoa faz parte do público do comunicado?
create or replace function app.no_publico(c public.comunicados, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.membros m where m.empresa_id = c.empresa_id and m.user_id = p_user and m.ativo
                 and (c.publico_perfis is null or m.perfil = any (c.publico_perfis)))
     and (c.publico_grupos is null or exists (select 1 from public.grupo_membros g
                                              where g.user_id = p_user and g.grupo_id = any (c.publico_grupos)))
     and (c.unidade_id is null or exists (select 1 from public.membro_unidades mu
                                          where mu.user_id = p_user and mu.unidade_id = c.unidade_id))
$$;

-- Comunicados no ar para a pessoa, com a situação dela na ocorrência atual
create or replace function app.comunicados_da_pessoa(p_empresa uuid, p_user uuid)
returns table (c public.comunicados, ocorrencia date, visto_em timestamptz, ciente_em timestamptz, pendente boolean)
language sql stable security definer set search_path = ''
as $$
  select x.c, x.oc, l.visto_em, l.ciente_em,
         case when (x.c).nivel = 'bloqueante' or (x.c).recorrencia = 'ate_confirmar' then l.ciente_em is null
              else l.visto_em is null end
  from (select c, app.comunicado_ocorrencia(c) oc from public.comunicados c
        where c.empresa_id = p_empresa and c.encerrado_em is null and c.inicio <= now()) x
  left join public.comunicado_leituras l on l.comunicado_id = (x.c).id and l.user_id = p_user and l.ocorrencia = x.oc
  where x.oc is not null and app.no_publico(x.c, p_user)
$$;

-- ---------------------------------------------------------------- funções do app
-- Pop-ups a mostrar ao abrir o app: bloqueantes primeiro, depois os mais recentes
create or replace function public.comunicados_pendentes(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(p.c) - 'publico_perfis' - 'publico_grupos' - 'criado_por' - 'encerrado_por'
                            || jsonb_build_object('ocorrencia', p.ocorrencia, 'visto_em', p.visto_em)
                            order by ((p.c).nivel = 'bloqueante') desc, (p.c).inicio desc), '[]'::jsonb)
  from app.comunicados_da_pessoa(p_empresa, (select auth.uid())) p
  where p.pendente and p_empresa in (select app.empresas_do_usuario())
$$;

-- Todos os comunicados no ar para a pessoa (tela Avisos)
create or replace function public.meus_comunicados(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(p.c) - 'publico_perfis' - 'publico_grupos' - 'criado_por' - 'encerrado_por'
                            || jsonb_build_object('ocorrencia', p.ocorrencia, 'visto_em', p.visto_em, 'ciente_em', p.ciente_em, 'pendente', p.pendente)
                            order by (p.c).inicio desc), '[]'::jsonb)
  from app.comunicados_da_pessoa(p_empresa, (select auth.uid())) p
  where p_empresa in (select app.empresas_do_usuario())
$$;

-- Registra que viu (p_ciente = false) ou que leu e entendeu (true)
create or replace function public.marcar_comunicado(p_comunicado uuid, p_ciente boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.comunicados; v_oc date; v_uid uuid := (select auth.uid());
begin
  select * into v_c from public.comunicados where id = p_comunicado;
  if not found or not app.no_publico(v_c, v_uid) then raise exception 'comunicado_nao_encontrado' using errcode = 'P0002'; end if;
  v_oc := app.comunicado_ocorrencia(v_c);
  if v_oc is null then raise exception 'comunicado_fora_do_ar' using errcode = 'P0001'; end if;
  insert into public.comunicado_leituras (comunicado_id, user_id, empresa_id, ocorrencia, ciente_em)
  values (v_c.id, v_uid, v_c.empresa_id, v_oc, case when p_ciente then now() end)
  on conflict (comunicado_id, user_id, ocorrencia)
  do update set ciente_em = coalesce(public.comunicado_leituras.ciente_em, excluded.ciente_em);
end;
$$;

-- Quem pode gerir: admin e gestor de frota (toda a empresa); gestor de base (só a própria filial)
create or replace function app.pode_gerir_comunicado(p_empresa uuid, p_unidade uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select app.tem_perfil(p_empresa, array['admin', 'gestor_frota']::public.perfil_membro[])
      or (p_unidade is not null and app.tem_perfil(p_empresa, array['gestor_base']::public.perfil_membro[])
          and app.usuario_ve_unidade((select auth.uid()), p_unidade))
$$;

-- Acompanhamento: o público da ocorrência (atual ou escolhida) e a situação de cada pessoa
create or replace function public.acompanhamento_comunicado(p_comunicado uuid, p_ocorrencia date default null)
returns table (user_id uuid, nome text, visto_em timestamptz, ciente_em timestamptz, ocorrencia date)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_c public.comunicados; v_oc date;
begin
  select * into v_c from public.comunicados where id = p_comunicado;
  if not found or not app.pode_gerir_comunicado(v_c.empresa_id, v_c.unidade_id) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_oc := coalesce(p_ocorrencia, app.comunicado_ocorrencia(v_c),
                   (select max(l.ocorrencia) from public.comunicado_leituras l where l.comunicado_id = v_c.id),
                   (v_c.inicio at time zone 'America/Sao_Paulo')::date);
  return query
  select p.user_id, p.nome, l.visto_em, l.ciente_em, v_oc
  from (select distinct on (m.user_id) m.user_id, m.nome from public.membros m
        where m.empresa_id = v_c.empresa_id and m.ativo and app.no_publico(v_c, m.user_id)
        order by m.user_id) p
  left join public.comunicado_leituras l on l.comunicado_id = v_c.id and l.user_id = p.user_id and l.ocorrencia = v_oc
  order by l.ciente_em nulls first, l.visto_em nulls first, p.nome;
end;
$$;

-- Bloqueio da reserva por comunicado bloqueante sem ciência do motorista
create or replace function app.conferir_comunicados_da_reserva()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from app.comunicados_da_pessoa(new.empresa_id, new.motorista_id) p
             where p.pendente and (p.c).nivel = 'bloqueante') then
    raise exception 'comunicado_pendente' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reservas_conferir_comunicados before insert on public.reservas
  for each row execute function app.conferir_comunicados_da_reserva();

-- Pendências para reservar ganham os comunicados bloqueantes
create or replace function public.pendencias_para_reservar(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'termos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'versao', t.versao, 'texto', t.texto) order by t.titulo)
      from public.termos t
      where t.empresa_id = p_empresa and t.ativo
        and not exists (select 1 from public.assinaturas_de_termo a where a.termo_id = t.id and a.user_id = (select auth.uid()))), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(n) from app.documentos_faltando(p_empresa, (select auth.uid()), null, current_date) n), '[]'::jsonb),
    'cnh', not exists (select 1 from public.cnhs c where c.user_id = (select auth.uid()) and c.empresa_id = p_empresa and c.validade >= current_date),
    'comunicados', coalesce((select jsonb_agg(jsonb_build_object('id', (p.c).id, 'titulo', (p.c).titulo))
      from app.comunicados_da_pessoa(p_empresa, (select auth.uid())) p
      where p.pendente and (p.c).nivel = 'bloqueante'), '[]'::jsonb)
  )
  where p_empresa in (select app.empresas_do_usuario())
$$;

-- ---------------------------------------------------------------- acesso
alter table public.comunicados enable row level security;
alter table public.comunicado_leituras enable row level security;
revoke all on public.comunicados, public.comunicado_leituras from anon, authenticated;
grant select, insert on public.comunicados to authenticated;
grant update (encerrado_em, encerrado_por) on public.comunicados to authenticated;
grant select on public.comunicado_leituras to authenticated;

create policy comunicados_select on public.comunicados for select to authenticated
  using (app.pode_gerir_comunicado(empresa_id, unidade_id));
create policy comunicados_insert on public.comunicados for insert to authenticated
  with check (app.pode_gerir_comunicado(empresa_id, unidade_id) and criado_por = (select auth.uid()));
create policy comunicados_update on public.comunicados for update to authenticated
  using (app.pode_gerir_comunicado(empresa_id, unidade_id))
  with check (app.pode_gerir_comunicado(empresa_id, unidade_id));
create policy leituras_select on public.comunicado_leituras for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.comunicados c where c.id = comunicado_id and app.pode_gerir_comunicado(c.empresa_id, c.unidade_id)));

create trigger auditar_comunicados after insert or update or delete on public.comunicados
  for each row execute function app.auditar();

revoke all on function app.comunicado_ocorrencia(public.comunicados, timestamptz) from public, anon, authenticated;
revoke all on function app.no_publico(public.comunicados, uuid) from public, anon, authenticated;
revoke all on function app.comunicados_da_pessoa(uuid, uuid) from public, anon, authenticated;
revoke all on function app.conferir_comunicados_da_reserva() from public, anon, authenticated;
revoke all on function app.pode_gerir_comunicado(uuid, uuid) from public, anon;
grant execute on function app.pode_gerir_comunicado(uuid, uuid) to authenticated;
revoke all on function public.comunicados_pendentes(uuid), public.meus_comunicados(uuid), public.marcar_comunicado(uuid, boolean),
  public.acompanhamento_comunicado(uuid, date) from public, anon;
grant execute on function public.comunicados_pendentes(uuid), public.meus_comunicados(uuid), public.marcar_comunicado(uuid, boolean),
  public.acompanhamento_comunicado(uuid, date) to authenticated;

-- Imagens: bucket privado; caminho = <empresa>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comunicados', 'comunicados', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy comunicados_imagens_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comunicados'
    and exists (select 1 from public.membros m where m.user_id = (select auth.uid()) and m.ativo
                and m.empresa_id::text = (storage.foldername(name))[1] and m.perfil in ('admin', 'gestor_frota', 'gestor_base')));
create policy comunicados_imagens_select on storage.objects for select to authenticated
  using (bucket_id = 'comunicados'
    and (storage.foldername(name))[1] in (select e::text from app.empresas_do_usuario() e));

-- Exportação LGPD inclui as leituras de comunicados
create or replace function public.meus_dados(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with eu as (select (select auth.uid()) as uid where p_empresa in (select app.empresas_do_usuario()))
  select jsonb_build_object(
    'gerado_em', now(),
    'empresa', (select e.nome from public.empresas e where e.id = p_empresa),
    'conta', (select jsonb_build_object('email', u.email, 'criada_em', u.created_at, 'ultimo_acesso', u.last_sign_in_at)
              from auth.users u, eu where u.id = eu.uid),
    'perfis', (select jsonb_agg(jsonb_build_object('perfil', m.perfil, 'nome', m.nome, 'ativo', m.ativo, 'desde', m.criado_em))
               from public.membros m, eu where m.user_id = eu.uid and m.empresa_id = p_empresa),
    'cnh', (select to_jsonb(c) - 'empresa_id' - 'user_id' from public.cnhs c, eu where c.user_id = eu.uid and c.empresa_id = p_empresa),
    'documentos', (select jsonb_agg(jsonb_build_object('tipo', t.nome, 'arquivo', d.nome_arquivo, 'validade', d.validade, 'status', d.status, 'enviado_em', d.enviado_em))
                   from public.documentos d join public.tipos_de_documento t on t.id = d.tipo_id, eu
                   where d.user_id = eu.uid and d.empresa_id = p_empresa),
    'termos_assinados', (select jsonb_agg(jsonb_build_object('termo', t.titulo, 'versao', t.versao, 'nome', a.nome_assinante, 'assinado_em', a.assinado_em, 'ip', a.ip, 'navegador', a.navegador))
                         from public.assinaturas_de_termo a join public.termos t on t.id = a.termo_id, eu
                         where a.user_id = eu.uid and a.empresa_id = p_empresa),
    'avisos_de_privacidade', (select jsonb_agg(jsonb_build_object('versao', av.versao, 'ciencia_em', c.em))
                              from public.ciencias_privacidade c join public.avisos_privacidade av on av.id = c.aviso_id, eu
                              where c.user_id = eu.uid and c.empresa_id = p_empresa),
    'reservas', (select jsonb_agg(jsonb_build_object('placa', v.placa, 'inicio', r.inicio, 'fim', r.fim, 'status', r.status,
                                   'finalidade', r.finalidade, 'destino', r.destino, 'centro_de_custo', r.centro_de_custo) order by r.inicio)
                 from public.reservas r join public.veiculos v on v.id = r.veiculo_id, eu
                 where (r.motorista_id = eu.uid or r.solicitante_id = eu.uid) and r.empresa_id = p_empresa),
    'vistorias', (select jsonb_agg(jsonb_build_object('tipo', vi.tipo, 'em', vi.criado_em, 'odometro_km', vi.odometro_km,
                                   'fotos', (select jsonb_agg(jsonb_build_object('posicao', f.posicao, 'tirada_em', f.tirada_em, 'latitude', f.latitude, 'longitude', f.longitude))
                                             from public.fotos f where f.vistoria_id = vi.id)))
                  from public.vistorias vi, eu where vi.autor_id = eu.uid and vi.empresa_id = p_empresa),
    'ocorrencias', (select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'em', i.registrada_em, 'endereco', i.endereco, 'latitude', i.latitude, 'longitude', i.longitude))
                    from public.incidentes i, eu where i.user_id = eu.uid and i.empresa_id = p_empresa),
    'faltas', (select jsonb_agg(jsonb_build_object('motivo', f.motivo, 'em', f.em)) from public.faltas f, eu where f.user_id = eu.uid and f.empresa_id = p_empresa),
    'suspensoes', (select jsonb_agg(jsonb_build_object('inicio', s.inicio, 'fim', s.fim, 'motivo', s.motivo, 'retirada_em', s.levantada_em))
                   from public.suspensoes s, eu where s.user_id = eu.uid and s.empresa_id = p_empresa),
    'pedidos_sobre_dados', (select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'descricao', s.descricao, 'status', s.status, 'resposta', s.resposta, 'em', s.criado_em))
                            from public.solicitacoes_titular s, eu where s.user_id = eu.uid and s.empresa_id = p_empresa),
    'comunicados', (select jsonb_agg(jsonb_build_object('titulo', c.titulo, 'ocorrencia', l.ocorrencia, 'visto_em', l.visto_em, 'ciente_em', l.ciente_em))
                    from public.comunicado_leituras l join public.comunicados c on c.id = l.comunicado_id, eu
                    where l.user_id = eu.uid and l.empresa_id = p_empresa)
  )
  from eu
$$;
