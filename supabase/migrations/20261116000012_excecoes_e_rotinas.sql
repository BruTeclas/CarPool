-- Sprint 5 · Exceções e rotinas automáticas
-- no-show, atraso, solicitação que expira sem aprovação, faltas e suspensão automática,
-- realocação de veículo, ocorrência (pane, acidente, roubo) com encerramento especial,
-- contatos de assistência, avisos dentro do sistema e rotinas agendadas (pg_cron).
-- A pane ou acidente fica em `incidentes` (a tabela `ocorrencias` do Sprint 4 é o registro geral de eventos).

create extension if not exists pg_cron;

-- Novas regras configuráveis por política
create or replace function app.politica_padrao()
returns jsonb language sql immutable set search_path = ''
as $$
  select '{
    "antecedencia_min_horas": 1,
    "antecedencia_max_dias": 60,
    "duracao_max_horas": 12,
    "limite_semanal_horas": 40,
    "intervalo_tecnico_min": 30,
    "tolerancia_noshow_min": 30,
    "tolerancia_atraso_min": 15,
    "cancelamento_min_horas": 2,
    "aprovar_pernoite": true,
    "aprovar_fim_de_semana": true,
    "suspensao_faltas": 3,
    "suspensao_janela_dias": 30,
    "suspensao_dias": 7,
    "realocacao_antecedencia_min": 120
  }'::jsonb
$$;

-- ---------------------------------------------------------------- tabelas

-- Avisos dentro do sistema (o e-mail fica para depois, ver plano)
create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  corpo text,
  link text,
  reserva_id uuid references public.reservas(id) on delete cascade,
  importante boolean not null default false,
  criada_em timestamptz not null default now(),
  lida_em timestamptz
);
create index on public.notificacoes (user_id, criada_em desc);
create index on public.notificacoes (user_id) where lida_em is null;
create index on public.notificacoes (empresa_id);
create index on public.notificacoes (reserva_id);

-- Faltas que contam para suspensão (uma por reserva e motivo)
create table public.faltas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  motivo text not null check (motivo in ('no_show', 'atraso')),
  em timestamptz not null default now(),
  unique (reserva_id, motivo)
);
create index on public.faltas (empresa_id, user_id, em desc);
create index on public.faltas (user_id);

create table public.suspensoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  inicio timestamptz not null default now(),
  fim timestamptz not null,
  motivo text not null,
  levantada_por uuid references auth.users(id) on delete set null,
  levantada_em timestamptz,
  motivo_levantamento text,
  check (fim > inicio)
);
create index on public.suspensoes (empresa_id, user_id);
create index on public.suspensoes (user_id);
create index on public.suspensoes (levantada_por);

-- Telefones de assistência: veiculo_id nulo = padrão da empresa; o do veículo tem prioridade
create table public.contatos_assistencia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid references public.veiculos(id) on delete cascade,
  seguradora text,
  apolice text,
  telefone_assistencia text not null check (length(trim(telefone_assistencia)) > 0),
  observacao text,
  criado_em timestamptz not null default now(),
  unique nulls not distinct (empresa_id, veiculo_id)
);
create index on public.contatos_assistencia (veiculo_id);

create table public.incidentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos(id),
  user_id uuid not null references auth.users(id),
  tipo text not null check (tipo in ('pane_mecanica', 'pneu_bateria', 'acidente_sem_vitima', 'acidente_com_vitima', 'roubo_furto')),
  descricao text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  precisao_m int,
  endereco text,
  fotos jsonb not null default '[]'::jsonb,
  registrada_em timestamptz not null,
  recebida_em timestamptz not null default now(),
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  encerrada_por uuid references auth.users(id) on delete set null,
  encerrada_em timestamptz,
  local_veiculo text,
  odometro_km int check (odometro_km >= 0),
  observacao_encerramento text
);
create index on public.incidentes (empresa_id, status);
create index on public.incidentes (reserva_id);
create index on public.incidentes (veiculo_id);
create index on public.incidentes (user_id);
create index on public.incidentes (encerrada_por);

create table public.realocacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  veiculo_original_id uuid not null references public.veiculos(id),
  veiculo_sugerido_id uuid references public.veiculos(id),
  motivo text not null check (motivo in ('atraso', 'ocorrencia')),
  status text not null check (status in ('oferecida', 'aceita', 'recusada', 'sem_alternativa')),
  criada_em timestamptz not null default now(),
  respondida_por uuid references auth.users(id) on delete set null,
  respondida_em timestamptz
);
create index on public.realocacoes (reserva_id);
create index on public.realocacoes (empresa_id, status);
create index on public.realocacoes (veiculo_original_id);
create index on public.realocacoes (veiculo_sugerido_id);
create index on public.realocacoes (respondida_por);

-- ---------------------------------------------------------------- acesso

alter table public.notificacoes enable row level security;
alter table public.faltas enable row level security;
alter table public.suspensoes enable row level security;
alter table public.contatos_assistencia enable row level security;
alter table public.incidentes enable row level security;
alter table public.realocacoes enable row level security;

revoke all on public.notificacoes, public.faltas, public.suspensoes, public.contatos_assistencia,
  public.incidentes, public.realocacoes from anon, authenticated;
grant select on public.notificacoes, public.faltas, public.suspensoes, public.incidentes, public.realocacoes to authenticated;
grant select, insert, update, delete on public.contatos_assistencia to authenticated;

create policy notificacoes_select on public.notificacoes for select to authenticated
  using (user_id = (select auth.uid()));

create policy faltas_select on public.faltas for select to authenticated
  using (user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));

create policy suspensoes_select on public.suspensoes for select to authenticated
  using (user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));

create policy contatos_select on public.contatos_assistencia for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy contatos_write on public.contatos_assistencia for all to authenticated
  using (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin','gestor_frota']::public.perfil_membro[]));

create policy incidentes_select on public.incidentes for select to authenticated
  using (user_id = (select auth.uid())
    or app.tem_perfil(empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]));

create policy realocacoes_select on public.realocacoes for select to authenticated
  using (exists (select 1 from public.reservas r where r.id = reserva_id));

create trigger auditar_suspensoes after insert or update or delete on public.suspensoes
  for each row execute function app.auditar();
create trigger auditar_contatos after insert or update or delete on public.contatos_assistencia
  for each row execute function app.auditar();
create trigger auditar_incidentes after insert or update or delete on public.incidentes
  for each row execute function app.auditar();
create trigger auditar_realocacoes after insert or update or delete on public.realocacoes
  for each row execute function app.auditar();
create trigger faltas_sem_update_delete before update or delete on public.faltas
  for each row execute function app.bloquear_alteracao();

-- ---------------------------------------------------------------- avisos

create or replace function app.notificar(
  p_empresa uuid, p_user uuid, p_tipo text, p_titulo text, p_corpo text,
  p_reserva uuid default null, p_importante boolean default false
) returns void language sql security definer set search_path = ''
as $$
  insert into public.notificacoes (empresa_id, user_id, tipo, titulo, corpo, link, reserva_id, importante)
  values (p_empresa, p_user, p_tipo, p_titulo, p_corpo,
          case when p_reserva is not null then '/reservas/' || p_reserva end, p_reserva, p_importante)
$$;

-- Gestão que cuida de um veículo: admin e gestor de frota da empresa, e gestor de base da filial do carro
create or replace function app.gestao_do_veiculo(p_empresa uuid, p_veiculo uuid)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select distinct m.user_id from public.membros m
  where m.empresa_id = p_empresa and m.ativo
    and (m.perfil in ('admin', 'gestor_frota')
      or (m.perfil = 'gestor_base' and p_veiculo is not null and app.usuario_ve_unidade(m.user_id,
            (select b.unidade_id from public.veiculos v join public.bases b on b.id = v.base_id where v.id = p_veiculo))))
$$;

create or replace function app.notificar_gestao(
  p_empresa uuid, p_veiculo uuid, p_tipo text, p_titulo text, p_corpo text,
  p_reserva uuid default null, p_importante boolean default false
) returns void language sql security definer set search_path = ''
as $$
  insert into public.notificacoes (empresa_id, user_id, tipo, titulo, corpo, link, reserva_id, importante)
  select p_empresa, g, p_tipo, p_titulo, p_corpo,
         case when p_reserva is not null then '/reservas/' || p_reserva end, p_reserva, p_importante
  from app.gestao_do_veiculo(p_empresa, p_veiculo) g
$$;

create or replace function public.marcar_notificacoes_lidas(p_ids uuid[] default null)
returns int language sql security definer set search_path = ''
as $$
  with feitas as (
    update public.notificacoes set lida_em = now()
    where user_id = (select auth.uid()) and lida_em is null and (p_ids is null or id = any (p_ids))
    returning 1
  ) select count(*)::int from feitas
$$;

-- Texto curto de horário no fuso de Brasília
create or replace function app.hora_br(p timestamptz)
returns text language sql stable set search_path = ''
as $$ select to_char(p at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') $$;

-- ---------------------------------------------------------------- faltas e suspensão

create or replace function app.registrar_falta(p_res public.reservas, p_motivo text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb := app.politica_efetiva(p_res.empresa_id, p_res.motorista_id,
    (select v.base_id from public.veiculos v where v.id = p_res.veiculo_id));
  v_limite int := (v_cfg ->> 'suspensao_faltas')::int;
  v_janela int := (v_cfg ->> 'suspensao_janela_dias')::int;
  v_dias int := (v_cfg ->> 'suspensao_dias')::int;
  v_total int;
  v_fim timestamptz;
begin
  insert into public.faltas (empresa_id, user_id, reserva_id, motivo)
  values (p_res.empresa_id, p_res.motorista_id, p_res.id, p_motivo)
  on conflict (reserva_id, motivo) do nothing;
  if not found then return; end if;

  select count(*) into v_total from public.faltas f
  where f.empresa_id = p_res.empresa_id and f.user_id = p_res.motorista_id
    and f.em > now() - make_interval(days => v_janela)
    and f.em > coalesce((select max(s.inicio) from public.suspensoes s
                         where s.empresa_id = p_res.empresa_id and s.user_id = p_res.motorista_id), '-infinity');
  if v_limite is null or v_limite <= 0 or v_total < v_limite then return; end if;
  if exists (select 1 from public.suspensoes s where s.empresa_id = p_res.empresa_id and s.user_id = p_res.motorista_id
             and s.levantada_em is null and s.fim > now()) then return; end if;

  v_fim := now() + make_interval(days => v_dias);
  insert into public.suspensoes (empresa_id, user_id, fim, motivo)
  values (p_res.empresa_id, p_res.motorista_id, v_fim,
          format('%s faltas (não comparecimento ou atraso) em %s dias', v_total, v_janela));
  perform app.notificar(p_res.empresa_id, p_res.motorista_id, 'suspensao', 'Reservas suspensas',
    format('Você teve %s faltas em %s dias e não poderá reservar até %s. Fale com o gestor da frota se houver engano.',
           v_total, v_janela, app.hora_br(v_fim)), null, true);
  perform app.notificar_gestao(p_res.empresa_id, null, 'suspensao', 'Motorista suspenso',
    format('%s foi suspenso até %s por %s faltas em %s dias.',
           coalesce((select m.nome from public.membros m where m.user_id = p_res.motorista_id and m.empresa_id = p_res.empresa_id limit 1), 'Um motorista'),
           app.hora_br(v_fim), v_total, v_janela));
end;
$$;

create or replace function app.conferir_suspensao()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_fim timestamptz;
begin
  select max(s.fim) into v_fim from public.suspensoes s
  where s.empresa_id = new.empresa_id and s.user_id = new.motorista_id and s.levantada_em is null and s.fim > now();
  if v_fim is not null then
    raise exception 'usuario_suspenso: %', app.hora_br(v_fim) using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reservas_conferir_suspensao before insert on public.reservas
  for each row execute function app.conferir_suspensao();

create or replace function public.levantar_suspensao(p_suspensao uuid, p_motivo text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_s public.suspensoes;
begin
  select * into v_s from public.suspensoes where id = p_suspensao for update;
  if not found or not app.tem_perfil(v_s.empresa_id, array['admin','gestor_frota']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'justificativa_obrigatoria' using errcode = 'P0001'; end if;
  update public.suspensoes set levantada_em = now(), levantada_por = (select auth.uid()), motivo_levantamento = trim(p_motivo)
  where id = p_suspensao and levantada_em is null;
  perform app.notificar(v_s.empresa_id, v_s.user_id, 'suspensao', 'Suspensão retirada',
    'O gestor retirou a sua suspensão. Você já pode reservar.', null, false);
end;
$$;

-- ---------------------------------------------------------------- realocação

-- Melhor veículo livre para assumir a reserva: mesma categoria e base primeiro, filial liberada ao
-- motorista, CNH compatível, documentos do carro em dia e sem conflito de agenda
create or replace function app.veiculo_alternativo(p_res public.reservas)
returns uuid language sql stable security definer set search_path = ''
as $$
  select v.id
  from public.veiculos v
  join public.bases b on b.id = v.base_id
  join public.categorias c on c.id = v.categoria_id
  cross join (select ve.categoria_id, ve.base_id from public.veiculos ve where ve.id = p_res.veiculo_id) o
  where v.empresa_id = p_res.empresa_id and v.id <> p_res.veiculo_id and v.status = 'ativo'
    and app.usuario_ve_unidade(p_res.motorista_id, b.unidade_id)
    and exists (select 1 from public.cnhs h where h.user_id = p_res.motorista_id and h.empresa_id = p_res.empresa_id
                and app.nivel_cnh(h.categoria) >= app.nivel_cnh(c.cnh_minima))
    and not exists (select 1 from app.documentos_faltando(v.empresa_id, null, v.id, (p_res.fim at time zone 'America/Sao_Paulo')::date))
    and not exists (
      select 1 from public.reservas r
      where r.veiculo_id = v.id and r.id <> p_res.id
        and r.status in ('aprovada', 'liberada', 'em_uso', 'atrasada', 'ocorrencia')
        and tstzrange(r.inicio, r.bloqueio_fim) && tstzrange(p_res.inicio, p_res.bloqueio_fim))
  order by (v.categoria_id = o.categoria_id) desc, (v.base_id = o.base_id) desc, v.odometro_km
  limit 1
$$;

create or replace function app.oferecer_realocacao(p_res public.reservas, p_motivo text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_alt uuid;
  v_placa text := (select placa from public.veiculos where id = p_res.veiculo_id);
  v_placa_alt text;
begin
  if exists (select 1 from public.realocacoes r where r.reserva_id = p_res.id
             and r.veiculo_original_id = p_res.veiculo_id and r.status in ('oferecida', 'sem_alternativa')) then
    return;
  end if;
  v_alt := app.veiculo_alternativo(p_res);
  insert into public.realocacoes (empresa_id, reserva_id, veiculo_original_id, veiculo_sugerido_id, motivo, status)
  values (p_res.empresa_id, p_res.id, p_res.veiculo_id, v_alt, p_motivo,
          case when v_alt is null then 'sem_alternativa' else 'oferecida' end);

  if v_alt is not null then
    v_placa_alt := (select placa from public.veiculos where id = v_alt);
    perform app.notificar(p_res.empresa_id, p_res.motorista_id, 'realocacao', 'Troca de veículo sugerida',
      format('O %s da sua reserva de %s pode não estar disponível (%s). Oferecemos o %s no mesmo horário: confirme na reserva.',
             v_placa, app.hora_br(p_res.inicio),
             case p_motivo when 'atraso' then 'a devolução anterior está atrasada' else 'o carro teve uma ocorrência' end,
             v_placa_alt), p_res.id, true);
  else
    perform app.notificar(p_res.empresa_id, p_res.motorista_id, 'realocacao', 'Veículo da sua reserva indisponível',
      format('O %s da sua reserva de %s pode não estar disponível e não há outro carro livre no horário. O gestor da frota foi avisado.',
             v_placa, app.hora_br(p_res.inicio)), p_res.id, true);
    perform app.notificar_gestao(p_res.empresa_id, p_res.veiculo_id, 'realocacao', 'Reserva sem veículo substituto',
      format('A reserva de %s com o %s está ameaçada (%s) e não há outro carro livre.',
             app.hora_br(p_res.inicio), v_placa,
             case p_motivo when 'atraso' then 'devolução anterior atrasada' else 'ocorrência com o carro' end), p_res.id, true);
  end if;
end;
$$;

create or replace function public.responder_realocacao(p_realocacao uuid, p_aceitar boolean)
returns public.reservas language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rel public.realocacoes;
  v_res public.reservas;
begin
  select * into v_rel from public.realocacoes where id = p_realocacao for update;
  if not found then raise exception 'realocacao_nao_encontrada' using errcode = 'P0002'; end if;
  select * into v_res from public.reservas where id = v_rel.reserva_id for update;
  if v_uid is null or not (v_uid in (v_res.motorista_id, v_res.solicitante_id)
      or app.tem_perfil(v_res.empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])) then
    raise exception 'realocacao_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_rel.status <> 'oferecida' or v_res.veiculo_id <> v_rel.veiculo_original_id
     or v_res.status not in ('solicitada', 'aprovada', 'liberada') then
    raise exception 'realocacao_encerrada' using errcode = 'P0001';
  end if;

  if not p_aceitar then
    update public.realocacoes set status = 'recusada', respondida_por = v_uid, respondida_em = now() where id = v_rel.id;
    return v_res;
  end if;

  begin
    update public.reservas set veiculo_id = v_rel.veiculo_sugerido_id where id = v_res.id returning * into v_res;
  exception when exclusion_violation then
    raise exception 'veiculo_sugerido_ocupado' using errcode = 'P0001';
  end;
  update public.realocacoes set status = 'aceita', respondida_por = v_uid, respondida_em = now() where id = v_rel.id;
  perform app.registrar_evento(v_res, v_res.status, jsonb_build_object(
    'realocada_de', v_rel.veiculo_original_id, 'realocada_para', v_rel.veiculo_sugerido_id, 'motivo', v_rel.motivo));
  return v_res;
end;
$$;

-- ---------------------------------------------------------------- ocorrência

create or replace function app.contato_assistencia(p_veiculo uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(c) - 'empresa_id' - 'criado_em'
  from public.contatos_assistencia c
  join public.veiculos v on v.id = p_veiculo and v.empresa_id = c.empresa_id
  where c.veiculo_id = p_veiculo or c.veiculo_id is null
  order by (c.veiculo_id is not null) desc
  limit 1
$$;

create or replace function public.registrar_ocorrencia(
  p_reserva uuid, p_tipo text, p_descricao text default null,
  p_latitude double precision default null, p_longitude double precision default null,
  p_precisao_m int default null, p_endereco text default null,
  p_fotos jsonb default '[]'::jsonb, p_registrada_em timestamptz default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.reservas;
  v_ve public.veiculos;
  v_id uuid;
  v_quando timestamptz := p_registrada_em;
  v_nome text;
  v_titulo text;
  v_prox public.reservas;
begin
  if v_uid is null then raise exception 'nao_autenticado' using errcode = '28000'; end if;
  select * into v_res from public.reservas where id = p_reserva for update;
  if not found or not (v_uid in (v_res.motorista_id, v_res.solicitante_id)
      or app.tem_perfil(v_res.empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[])) then
    raise exception 'reserva_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_res.status not in ('em_uso', 'atrasada', 'ocorrencia') then
    raise exception 'ocorrencia_fora_do_uso' using errcode = 'P0001';
  end if;
  -- horário do aparelho vale se não estiver no futuro e tiver menos de 48 h (registro feito sem sinal)
  if v_quando is null or v_quando > now() + interval '5 minutes' or v_quando < now() - interval '48 hours' then
    v_quando := now();
  end if;

  select * into v_ve from public.veiculos where id = v_res.veiculo_id;
  insert into public.incidentes (empresa_id, reserva_id, veiculo_id, user_id, tipo, descricao,
    latitude, longitude, precisao_m, endereco, fotos, registrada_em)
  values (v_res.empresa_id, v_res.id, v_ve.id, v_uid, p_tipo, nullif(trim(p_descricao), ''),
    p_latitude, p_longitude, p_precisao_m, nullif(trim(p_endereco), ''), coalesce(p_fotos, '[]'::jsonb), v_quando)
  returning id into v_id;

  if v_res.status <> 'ocorrencia' then
    v_res := app.mudar_status(v_res.id, 'ocorrencia', jsonb_build_object('ocorrencia_id', v_id, 'tipo', p_tipo));
    update public.veiculos set status = 'bloqueado' where id = v_ve.id and status = 'ativo';
  end if;

  v_nome := coalesce((select m.nome from public.membros m where m.user_id = v_res.motorista_id
                      and m.empresa_id = v_res.empresa_id limit 1), 'Motorista');
  v_titulo := case p_tipo
    when 'pane_mecanica' then 'Pane mecânica' when 'pneu_bateria' then 'Pneu ou bateria'
    when 'acidente_sem_vitima' then 'Acidente sem vítima' when 'acidente_com_vitima' then 'Acidente com vítima'
    else 'Roubo ou furto' end;
  perform app.notificar_gestao(v_res.empresa_id, v_ve.id, 'ocorrencia', v_titulo || ' com o ' || v_ve.placa,
    format('%s registrou %s em %s.%s', v_nome, lower(v_titulo), app.hora_br(v_quando),
           case when p_endereco is not null then ' Local: ' || trim(p_endereco) || '.'
                when p_latitude is not null then ' Localização enviada pelo celular.' else '' end),
    v_res.id, true);

  for v_prox in
    select * from public.reservas r
    where r.veiculo_id = v_ve.id and r.id <> v_res.id
      and r.status in ('solicitada', 'aprovada', 'liberada') and r.fim > now()
    order by r.inicio
  loop
    perform app.oferecer_realocacao(v_prox, 'ocorrencia');
  end loop;

  return jsonb_build_object('ocorrencia_id', v_id, 'assistencia', app.contato_assistencia(v_ve.id));
end;
$$;

create or replace function public.encerrar_ocorrencia(
  p_ocorrencia uuid, p_local_veiculo text, p_odometro_km int default null,
  p_observacao text default null, p_status_veiculo public.status_veiculo default 'manutencao'
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_oc public.incidentes;
  v_res public.reservas;
begin
  select * into v_oc from public.incidentes where id = p_ocorrencia for update;
  if not found or not app.tem_perfil(v_oc.empresa_id, array['admin','gestor_frota','gestor_base']::public.perfil_membro[]) then
    raise exception 'ocorrencia_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_oc.status <> 'aberta' then raise exception 'ocorrencia_ja_encerrada' using errcode = 'P0001'; end if;
  if coalesce(trim(p_local_veiculo), '') = '' then raise exception 'local_obrigatorio' using errcode = 'P0001'; end if;

  -- todas as ocorrências abertas da mesma reserva são encerradas juntas
  update public.incidentes set status = 'encerrada', encerrada_por = v_uid, encerrada_em = now(),
    local_veiculo = trim(p_local_veiculo), odometro_km = p_odometro_km, observacao_encerramento = nullif(trim(p_observacao), '')
  where reserva_id = v_oc.reserva_id and status = 'aberta';

  select * into v_res from public.reservas where id = v_oc.reserva_id;
  if v_res.status = 'ocorrencia' then
    perform app.mudar_status(v_res.id, 'encerrada', jsonb_build_object(
      'encerramento_especial', true, 'ocorrencia_id', v_oc.id, 'local_veiculo', trim(p_local_veiculo),
      'odometro_km', p_odometro_km, 'observacao', nullif(trim(p_observacao), '')));
  end if;
  update public.veiculos set status = coalesce(p_status_veiculo, 'manutencao'),
    odometro_km = greatest(odometro_km, coalesce(p_odometro_km, 0))
  where id = v_oc.veiculo_id;

  perform app.notificar(v_oc.empresa_id, v_res.motorista_id, 'ocorrencia', 'Ocorrência encerrada',
    format('O gestor encerrou a ocorrência com o veículo. Local informado: %s.', trim(p_local_veiculo)), v_res.id, false);
end;
$$;

-- ---------------------------------------------------------------- rotinas

-- A cada minuto: solicitação vencida, não comparecimento, atraso e realocação
create or replace function app.rotina_minuto()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_res public.reservas;
  v_prox public.reservas;
begin
  -- Solicitação que chegou ao horário sem aprovação: expira (não conta como falta)
  for r in select * from public.reservas where status = 'solicitada' and inicio <= now() loop
    v_res := app.mudar_status(r.id, 'cancelada', '{"automatico": true, "motivo": "expirou_sem_aprovacao"}');
    perform app.notificar(r.empresa_id, r.motorista_id, 'expirada', 'Solicitação expirada',
      format('A sua solicitação para %s não foi aprovada a tempo e expirou.', app.hora_br(r.inicio)), r.id, false);
  end loop;

  -- Não comparecimento: aprovada ou chave lida, mas sem retirada até o fim da tolerância
  for r in
    select x.*, (app.politica_efetiva(x.empresa_id, x.motorista_id, v.base_id) ->> 'tolerancia_noshow_min')::int as tol
    from public.reservas x join public.veiculos v on v.id = x.veiculo_id
    where x.status in ('aprovada', 'liberada') and x.inicio < now()
  loop
    continue when now() < r.inicio + make_interval(mins => r.tol);
    v_res := app.mudar_status(r.id, 'no_show', jsonb_build_object('automatico', true, 'tolerancia_min', r.tol));
    perform app.registrar_falta(v_res, 'no_show');
    perform app.notificar(r.empresa_id, r.motorista_id, 'no_show', 'Reserva perdida por não comparecimento',
      format('O veículo não foi retirado até %s minutos depois do horário marcado (%s). A reserva foi encerrada e o carro liberado.',
             r.tol, app.hora_br(r.inicio)), r.id, true);
  end loop;

  -- Atraso: em uso depois do fim + tolerância
  for r in
    select x.*, (app.politica_efetiva(x.empresa_id, x.motorista_id, v.base_id) ->> 'tolerancia_atraso_min')::int as tol,
           v.placa
    from public.reservas x join public.veiculos v on v.id = x.veiculo_id
    where x.status = 'em_uso' and x.fim < now()
  loop
    continue when now() < r.fim + make_interval(mins => r.tol);
    v_res := app.mudar_status(r.id, 'atrasada', jsonb_build_object('automatico', true, 'tolerancia_min', r.tol));
    perform app.registrar_falta(v_res, 'atraso');
    perform app.notificar(r.empresa_id, r.motorista_id, 'atraso', 'Devolução atrasada',
      format('A devolução do %s era até %s. Devolva o quanto antes ou avise o gestor da frota.', r.placa, app.hora_br(r.fim)),
      r.id, true);
    perform app.notificar_gestao(r.empresa_id, r.veiculo_id, 'atraso', 'Devolução atrasada: ' || r.placa,
      format('%s deveria ter devolvido o %s até %s.',
             coalesce((select m.nome from public.membros m where m.user_id = r.motorista_id and m.empresa_id = r.empresa_id limit 1), 'O motorista'),
             r.placa, app.hora_br(r.fim)), r.id, false);
  end loop;

  -- Realocação: próximas reservas de um carro atrasado que começam dentro da antecedência configurada
  for r in select * from public.reservas where status = 'atrasada' loop
    for v_prox in
      select p.* from public.reservas p join public.veiculos v on v.id = p.veiculo_id
      where p.veiculo_id = r.veiculo_id and p.id <> r.id
        and p.status in ('solicitada', 'aprovada', 'liberada')
        and p.inicio > r.inicio
        and p.inicio < now() + make_interval(mins =>
              (app.politica_efetiva(p.empresa_id, p.motorista_id, v.base_id) ->> 'realocacao_antecedencia_min')::int)
    loop
      perform app.oferecer_realocacao(v_prox, 'atraso');
    end loop;
  end loop;
end;
$$;

-- Uma vez por dia: avisos de documento vencendo (no prazo da empresa, 15, 7 e 1 dia, no dia e no dia seguinte)
create or replace function app.rotina_diaria()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_texto text;
begin
  for r in
    select d.id, d.empresa_id, d.user_id, d.veiculo_id, d.validade, t.nome as tipo, v.placa,
           (d.validade - v_hoje) as dias, e.aviso_vencimento_dias as prazo
    from app.documentos_em_vigor d
    join public.tipos_de_documento t on t.id = d.tipo_id and t.ativo
    join public.empresas e on e.id = d.empresa_id
    left join public.veiculos v on v.id = d.veiculo_id
    where d.validade is not null
      and (d.validade - v_hoje) in (e.aviso_vencimento_dias, 15, 7, 1, 0, -1)
  loop
    v_texto := case when r.dias < 0 then 'venceu ontem' when r.dias = 0 then 'vence hoje'
                    when r.dias = 1 then 'vence amanhã' else format('vence em %s dias', r.dias) end;
    if r.user_id is not null then
      perform app.notificar(r.empresa_id, r.user_id, 'documento', format('%s %s', r.tipo, v_texto),
        format('Validade: %s. Envie o documento renovado em Meus documentos para continuar reservando.',
               to_char(r.validade, 'DD/MM/YYYY')), null, r.dias <= 7);
    end if;
    perform app.notificar_gestao(r.empresa_id, r.veiculo_id, 'documento',
      format('%s %s', r.tipo, v_texto),
      format('%s, validade %s.',
             coalesce(r.placa, (select m.nome from public.membros m where m.user_id = r.user_id and m.empresa_id = r.empresa_id limit 1)),
             to_char(r.validade, 'DD/MM/YYYY')), null, false);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- permissões das funções

revoke all on function app.notificar(uuid, uuid, text, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function app.gestao_do_veiculo(uuid, uuid) from public, anon, authenticated;
revoke all on function app.notificar_gestao(uuid, uuid, text, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function app.registrar_falta(public.reservas, text) from public, anon, authenticated;
revoke all on function app.conferir_suspensao() from public, anon, authenticated;
revoke all on function app.veiculo_alternativo(public.reservas) from public, anon, authenticated;
revoke all on function app.oferecer_realocacao(public.reservas, text) from public, anon, authenticated;
revoke all on function app.contato_assistencia(uuid) from public, anon, authenticated;
revoke all on function app.rotina_minuto() from public, anon, authenticated;
revoke all on function app.rotina_diaria() from public, anon, authenticated;

revoke all on function public.marcar_notificacoes_lidas(uuid[]) from public, anon;
revoke all on function public.levantar_suspensao(uuid, text) from public, anon;
revoke all on function public.responder_realocacao(uuid, boolean) from public, anon;
revoke all on function public.registrar_ocorrencia(uuid, text, text, double precision, double precision, int, text, jsonb, timestamptz) from public, anon;
revoke all on function public.encerrar_ocorrencia(uuid, text, int, text, public.status_veiculo) from public, anon;
grant execute on function public.marcar_notificacoes_lidas(uuid[]) to authenticated;
grant execute on function public.levantar_suspensao(uuid, text) to authenticated;
grant execute on function public.responder_realocacao(uuid, boolean) to authenticated;
grant execute on function public.registrar_ocorrencia(uuid, text, text, double precision, double precision, int, text, jsonb, timestamptz) to authenticated;
grant execute on function public.encerrar_ocorrencia(uuid, text, int, text, public.status_veiculo) to authenticated;

-- ---------------------------------------------------------------- agenda

select cron.unschedule(jobid) from cron.job where jobname in ('carpool-rotina-minuto', 'carpool-rotina-diaria');
select cron.schedule('carpool-rotina-minuto', '* * * * *', 'select app.rotina_minuto()');
-- 08:07 em Brasília (11:07 UTC)
select cron.schedule('carpool-rotina-diaria', '7 11 * * *', 'select app.rotina_diaria()');
