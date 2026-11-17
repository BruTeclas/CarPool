-- Super admin: a equipe dona do sistema. Cadastra empresas (CNPJ), liga e desliga módulos, define limites
-- do plano, suspende e reativa, convida o primeiro admin de cada empresa e acompanha o uso.
-- No dia a dia NÃO enxerga os dados das empresas; para suporte, "entra como" admin por 2 horas,
-- com motivo obrigatório, e tudo o que fizer fica na auditoria (o vínculo de suporte também).

-- ---------------------------------------------------------------- quem é super admin
create table public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id) on delete set null
);
create index on public.super_admins (criado_por);

create or replace function app.eh_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.super_admins s where s.user_id = (select auth.uid())) $$;

create or replace function public.sou_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select app.eh_super_admin() $$;

alter table public.super_admins enable row level security;
revoke all on public.super_admins from anon, authenticated;
grant select on public.super_admins to authenticated;
create policy super_admins_select on public.super_admins for select to authenticated
  using (user_id = (select auth.uid()) or app.eh_super_admin());

-- ---------------------------------------------------------------- dados da empresa controlados pelo super admin
create or replace function app.cnpj_valido(p text)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare d int[]; s int; r int; i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if p !~ '^\d{14}$' or p ~ '^(\d)\1{13}$' then return false; end if;
  d := array(select substr(p, g, 1)::int from generate_series(1, 14) g);
  s := 0; for i in 1..12 loop s := s + d[i] * p1[i]; end loop;
  r := s % 11; if (case when r < 2 then 0 else 11 - r end) <> d[13] then return false; end if;
  s := 0; for i in 1..13 loop s := s + d[i] * p2[i]; end loop;
  r := s % 11; return (case when r < 2 then 0 else 11 - r end) = d[14];
end;
$$;

alter table public.empresas
  add column cnpj text unique check (cnpj is null or app.cnpj_valido(cnpj)),
  add column razao_social text check (razao_social is null or length(trim(razao_social)) > 0),
  add column situacao text not null default 'ativa' check (situacao in ('ativa', 'suspensa')),
  add column suspensa_em timestamptz,
  add column motivo_suspensao text,
  add column limite_usuarios int check (limite_usuarios is null or limite_usuarios > 0),
  add column limite_veiculos int check (limite_veiculos is null or limite_veiculos > 0),
  add column limite_filiais int check (limite_filiais is null or limite_filiais > 0),
  add column modulos text[] not null default array['treinamentos', 'relatorios', 'documentos', 'ocorrencias']
    check (modulos <@ array['treinamentos', 'relatorios', 'documentos', 'ocorrencias']);

-- O admin do cliente continua editando o que é dele (prazos de LGPD, encarregado etc.), mas não o que é do super admin
create or replace function app.empresa_campos_do_super()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not app.eh_super_admin() and (
       new.cnpj, new.razao_social, new.situacao, new.suspensa_em, new.motivo_suspensao,
       new.limite_usuarios, new.limite_veiculos, new.limite_filiais, new.modulos
     ) is distinct from (
       old.cnpj, old.razao_social, old.situacao, old.suspensa_em, old.motivo_suspensao,
       old.limite_usuarios, old.limite_veiculos, old.limite_filiais, old.modulos) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger empresas_campos_do_super before update on public.empresas
  for each row execute function app.empresa_campos_do_super();

create or replace function app.modulo_ativo(p_empresa uuid, p_modulo text)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select p_modulo = any (e.modulos) from public.empresas e where e.id = p_empresa), false) $$;

create or replace function app.exigir_modulo(p_empresa uuid, p_modulo text)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.modulo_ativo(p_empresa, p_modulo) then raise exception 'modulo_desligado: %', p_modulo using errcode = 'P0001'; end if;
end;
$$;

-- ---------------------------------------------------------------- acesso de suporte
alter table public.membros add column suporte_ate timestamptz, add column suporte_motivo text;
create index on public.membros (user_id) where suporte_ate is not null;

-- O vínculo de suporte vale só até suporte_ate (a rotina apaga os vencidos)
create or replace function app.empresas_do_usuario()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select m.empresa_id from public.membros m
  where m.user_id = (select auth.uid()) and m.ativo and (m.suporte_ate is null or m.suporte_ate > now())
$$;

create or replace function app.tem_perfil(p_empresa uuid, p_perfis public.perfil_membro[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.membros m
    where m.user_id = (select auth.uid()) and m.empresa_id = p_empresa and m.ativo
      and (m.suporte_ate is null or m.suporte_ate > now()) and m.perfil = any (p_perfis))
$$;

-- O suporte não conta como administrador da empresa nem entra em públicos de comunicado e treinamento
create or replace function app.proteger_ultimo_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.perfil = 'admin' and old.ativo and old.suporte_ate is null and (new.perfil <> 'admin' or not new.ativo)
     and not exists (
       select 1 from public.membros m
       where m.empresa_id = old.empresa_id and m.perfil = 'admin' and m.ativo and m.id <> old.id and m.suporte_ate is null) then
    raise exception 'ultimo_admin' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function app.publico_inclui(p_empresa uuid, p_perfis public.perfil_membro[], p_grupos uuid[], p_unidade uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = p_user and m.ativo
                 and m.suporte_ate is null and (p_perfis is null or m.perfil = any (p_perfis)))
     and (p_grupos is null or exists (select 1 from public.grupo_membros g where g.user_id = p_user and g.grupo_id = any (p_grupos)))
     and (p_unidade is null or exists (select 1 from public.membro_unidades mu where mu.user_id = p_user and mu.unidade_id = p_unidade))
$$;

create or replace function app.no_publico(c public.comunicados, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.publico_inclui(c.empresa_id, c.publico_perfis, c.publico_grupos, c.unidade_id, p_user) $$;

create or replace function public.super_entrar_como(p_empresa uuid, p_motivo text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if not app.eh_super_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'motivo_obrigatorio' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'empresa_nao_encontrada' using errcode = 'P0002'; end if;
  if exists (select 1 from public.membros where empresa_id = p_empresa and user_id = v_uid and suporte_ate is null) then
    raise exception 'voce_ja_e_membro' using errcode = 'P0001';
  end if;
  delete from public.membros where user_id = v_uid and suporte_ate is not null;   -- um suporte por vez
  insert into public.membros (empresa_id, user_id, perfil, nome, suporte_ate, suporte_motivo)
  values (p_empresa, v_uid, 'admin', 'Suporte CarPool', now() + interval '2 hours', trim(p_motivo));
end;
$$;

create or replace function public.super_sair_suporte()
returns void language sql security definer set search_path = ''
as $$ delete from public.membros where user_id = (select auth.uid()) and suporte_ate is not null $$;

-- ---------------------------------------------------------------- suspensão e limites do plano
create or replace function app.conferir_empresa_e_plano()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_e public.empresas; v_qtd int; v_suspende boolean := false;
begin
  -- cada tabela tem campos diferentes: as conferências ficam separadas por tabela
  if tg_table_name = 'membros' then
    if new.suporte_ate is not null then return new; end if;  -- o suporte entra mesmo em empresa suspensa
  end if;
  select * into v_e from public.empresas where id = new.empresa_id;

  if v_e.situacao = 'suspensa' then
    if tg_op = 'INSERT' then
      v_suspende := true;
    elsif tg_table_name = 'reservas' then
      v_suspende := new.status in ('liberada', 'em_uso') and new.status is distinct from old.status;
    elsif tg_table_name = 'membros' then
      v_suspende := new.ativo and not old.ativo;
    end if;
    if v_suspende then raise exception 'empresa_suspensa' using errcode = 'P0001'; end if;
  end if;

  if tg_table_name = 'membros' then
    if new.ativo and (tg_op = 'INSERT' or not old.ativo) and v_e.limite_usuarios is not null
       and not exists (select 1 from public.membros m where m.empresa_id = new.empresa_id and m.user_id = new.user_id and m.ativo
                       and m.suporte_ate is null and m.id is distinct from new.id) then
      select count(distinct m.user_id) into v_qtd from public.membros m where m.empresa_id = new.empresa_id and m.ativo and m.suporte_ate is null;
      if v_qtd >= v_e.limite_usuarios then raise exception 'limite_do_plano: usuarios' using errcode = 'P0001'; end if;
    end if;
  elsif tg_table_name = 'veiculos' and tg_op = 'INSERT' and v_e.limite_veiculos is not null then
    select count(*) into v_qtd from public.veiculos where empresa_id = new.empresa_id;
    if v_qtd >= v_e.limite_veiculos then raise exception 'limite_do_plano: veiculos' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'unidades' and tg_op = 'INSERT' and v_e.limite_filiais is not null then
    select count(*) into v_qtd from public.unidades where empresa_id = new.empresa_id;
    if v_qtd >= v_e.limite_filiais then raise exception 'limite_do_plano: filiais' using errcode = 'P0001'; end if;
  end if;
  return new;
end;
$$;
create trigger membros_empresa_e_plano before insert or update of ativo on public.membros
  for each row execute function app.conferir_empresa_e_plano();
create trigger veiculos_empresa_e_plano before insert on public.veiculos
  for each row execute function app.conferir_empresa_e_plano();
create trigger unidades_empresa_e_plano before insert on public.unidades
  for each row execute function app.conferir_empresa_e_plano();
create trigger bases_empresa_ativa before insert on public.bases
  for each row execute function app.conferir_empresa_e_plano();
-- o "0" no nome faz esta conferência rodar antes das outras da reserva (a mensagem certa é a da suspensão)
create trigger reservas_0_empresa_ativa before insert or update of status on public.reservas
  for each row execute function app.conferir_empresa_e_plano();

-- ---------------------------------------------------------------- módulos: desligado, as regras dele deixam de valer
create or replace function app.conferir_modulo()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform app.exigir_modulo(new.empresa_id, tg_argv[0]);
  return new;
end;
$$;
create trigger incidentes_modulo before insert on public.incidentes for each row execute function app.conferir_modulo('ocorrencias');
create trigger treinamentos_modulo before insert on public.treinamentos for each row execute function app.conferir_modulo('treinamentos');
create trigger comunicados_modulo before insert on public.comunicados for each row execute function app.conferir_modulo('treinamentos');
create trigger documentos_modulo before insert on public.documentos for each row execute function app.conferir_modulo('documentos');
create trigger termos_modulo before insert on public.termos for each row execute function app.conferir_modulo('documentos');

create or replace function app.documentos_faltando(p_empresa uuid, p_user uuid, p_veiculo uuid, p_ate date)
returns setof text language sql stable security definer set search_path = ''
as $$
  select t.nome from public.tipos_de_documento t
  where t.empresa_id = p_empresa and t.ativo and t.obrigatorio and not t.e_cnh
    and app.modulo_ativo(p_empresa, 'documentos')
    and ((t.alvo = 'condutor' and p_user is not null) or (t.alvo = 'veiculo' and p_veiculo is not null))
    and not exists (
      select 1 from app.documentos_em_vigor d
      where d.tipo_id = t.id
        and ((t.alvo = 'condutor' and d.user_id = p_user) or (t.alvo = 'veiculo' and d.veiculo_id = p_veiculo))
        and (d.validade is null or d.validade >= p_ate))
  order by t.nome
$$;

create or replace function app.conferir_documentos_da_reserva()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_falta text; v_ate date := (new.fim at time zone 'America/Sao_Paulo')::date;
begin
  if not app.modulo_ativo(new.empresa_id, 'documentos') then return new; end if;
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

create or replace function app.comunicados_da_pessoa(p_empresa uuid, p_user uuid)
returns table (c public.comunicados, ocorrencia date, visto_em timestamptz, ciente_em timestamptz, pendente boolean)
language sql stable security definer set search_path = ''
as $$
  select x.c, x.oc, l.visto_em, l.ciente_em,
         case when (x.c).nivel = 'bloqueante' or (x.c).recorrencia = 'ate_confirmar' then l.ciente_em is null
              else l.visto_em is null end
  from (select c, app.comunicado_ocorrencia(c) oc from public.comunicados c
        where c.empresa_id = p_empresa and c.encerrado_em is null and c.inicio <= now()
          and app.modulo_ativo(p_empresa, 'treinamentos')) x
  left join public.comunicado_leituras l on l.comunicado_id = (x.c).id and l.user_id = p_user and l.ocorrencia = x.oc
  where x.oc is not null and app.no_publico(x.c, p_user)
$$;

create or replace function app.treinamentos_obrigatorios(p_empresa uuid, p_user uuid)
returns table (treinamento_id uuid, familia_id uuid, titulo text, bloqueio text, prazo_ate timestamptz,
               aprovado_em timestamptz, valido_ate timestamptz, nota numeric, em_dia boolean, bloqueando boolean)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.familia_id, t.titulo, t.bloqueio, x.prazo_ate, a.aprovado_em, a.valido_ate, a.nota,
         x.em_dia, not x.em_dia and x.prazo_ate <= now()
  from public.treinamentos t
  left join lateral (
    select m.aprovado_em, m.valido_ate, m.nota from public.treinamento_matriculas m
    join public.treinamentos t2 on t2.id = m.treinamento_id
    where t2.familia_id = t.familia_id and m.user_id = p_user and m.aprovado_em is not null
    order by m.aprovado_em desc limit 1
  ) a on true
  cross join lateral (
    select a.aprovado_em is not null and (a.valido_ate is null or a.valido_ate > now()) as em_dia,
           case when a.aprovado_em is not null then a.valido_ate
                else greatest((select min(t3.publicado_em) from public.treinamentos t3 where t3.familia_id = t.familia_id),
                              (select min(m.criado_em) from public.membros m where m.empresa_id = p_empresa and m.user_id = p_user))
                     + make_interval(days => t.prazo_dias) end as prazo_ate
  ) x
  where t.empresa_id = p_empresa and t.publicado_em is not null and t.ativo and t.bloqueio <> 'nenhum'
    and app.modulo_ativo(p_empresa, 'treinamentos')
    and app.publico_inclui(t.empresa_id, t.publico_perfis, t.publico_grupos, t.unidade_id, p_user)
$$;

create or replace function public.pendencias_para_reservar(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'termos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'versao', t.versao, 'texto', t.texto) order by t.titulo)
      from public.termos t
      where t.empresa_id = p_empresa and t.ativo and app.modulo_ativo(p_empresa, 'documentos')
        and not exists (select 1 from public.assinaturas_de_termo a where a.termo_id = t.id and a.user_id = (select auth.uid()))), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(n) from app.documentos_faltando(p_empresa, (select auth.uid()), null, current_date) n), '[]'::jsonb),
    'cnh', not exists (select 1 from public.cnhs c where c.user_id = (select auth.uid()) and c.empresa_id = p_empresa and c.validade >= current_date),
    'comunicados', coalesce((select jsonb_agg(jsonb_build_object('id', (p.c).id, 'titulo', (p.c).titulo))
      from app.comunicados_da_pessoa(p_empresa, (select auth.uid())) p
      where p.pendente and (p.c).nivel = 'bloqueante'), '[]'::jsonb),
    'treinamentos', coalesce((select jsonb_agg(jsonb_build_object('id', o.treinamento_id, 'titulo', o.titulo, 'prazo_ate', o.prazo_ate, 'vencido', o.aprovado_em is not null))
      from app.treinamentos_obrigatorios(p_empresa, (select auth.uid())) o
      where o.bloqueando and o.bloqueio in ('reservas', 'reservas_e_retiradas')), '[]'::jsonb),
    'empresa_suspensa', (select e.situacao = 'suspensa' from public.empresas e where e.id = p_empresa)
  )
  where p_empresa in (select app.empresas_do_usuario())
$$;

-- Relatórios: acrescenta a conferência do módulo no começo das duas funções, sem reescrever o corpo
do $$
declare f text;
begin
  foreach f in array array['public.relatorio_frota(uuid, date, date, uuid)', 'public.relatorio_reservas(uuid, date, date, uuid)'] loop
    execute regexp_replace(pg_get_functiondef(f::regprocedure), '\mbegin\M', 'begin
  perform app.exigir_modulo(p_empresa, ''relatorios'');');
  end loop;
end $$;

-- ---------------------------------------------------------------- funções do painel do super admin
create or replace function app.so_super_admin()
returns void language plpgsql stable security definer set search_path = ''
as $$ begin if not app.eh_super_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if; end; $$;

-- Lista de empresas com números de uso (sem dados pessoais de motoristas)
create or replace function public.super_empresas()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.so_super_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.situacao,
      'suspensa_em', e.suspensa_em, 'motivo_suspensao', e.motivo_suspensao, 'modulos', to_jsonb(e.modulos),
      'limite_usuarios', e.limite_usuarios, 'limite_veiculos', e.limite_veiculos, 'limite_filiais', e.limite_filiais,
      'criado_em', e.criado_em,
      'usuarios', (select count(distinct m.user_id) from public.membros m where m.empresa_id = e.id and m.ativo and m.suporte_ate is null),
      'admins', (select count(distinct m.user_id) from public.membros m where m.empresa_id = e.id and m.ativo and m.suporte_ate is null and m.perfil = 'admin'),
      'veiculos', (select count(*) from public.veiculos v where v.empresa_id = e.id),
      'filiais', (select count(*) from public.unidades u where u.empresa_id = e.id),
      'reservas_30d', (select count(*) from public.reservas r where r.empresa_id = e.id and r.criado_em > now() - interval '30 days'),
      'ultimo_acesso', (select max(u.last_sign_in_at) from public.membros m join auth.users u on u.id = m.user_id
                        where m.empresa_id = e.id and m.suporte_ate is null))
    order by e.nome) from public.empresas e), '[]'::jsonb);
end;
$$;

create or replace function public.super_salvar_empresa(p_id uuid, p_nome text, p_razao_social text, p_cnpj text, p_modulos text[],
  p_limite_usuarios int, p_limite_veiculos int, p_limite_filiais int)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
begin
  perform app.so_super_admin();
  if coalesce(trim(p_nome), '') = '' then raise exception 'nome_obrigatorio' using errcode = 'P0001'; end if;
  if v_cnpj is not null and not app.cnpj_valido(v_cnpj) then raise exception 'cnpj_invalido' using errcode = 'P0001'; end if;
  if exists (select 1 from public.empresas where cnpj = v_cnpj and id is distinct from p_id) then raise exception 'cnpj_ja_cadastrado' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.empresas (nome, razao_social, cnpj, modulos, limite_usuarios, limite_veiculos, limite_filiais)
    values (trim(p_nome), nullif(trim(p_razao_social), ''), v_cnpj, coalesce(p_modulos, '{}'), p_limite_usuarios, p_limite_veiculos, p_limite_filiais)
    returning id into v_id;
  else
    update public.empresas set nome = trim(p_nome), razao_social = nullif(trim(p_razao_social), ''), cnpj = v_cnpj, modulos = coalesce(p_modulos, '{}'),
      limite_usuarios = p_limite_usuarios, limite_veiculos = p_limite_veiculos, limite_filiais = p_limite_filiais
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'empresa_nao_encontrada' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.super_suspender_empresa(p_id uuid, p_suspender boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform app.so_super_admin();
  if p_suspender and coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'motivo_obrigatorio' using errcode = 'P0001'; end if;
  update public.empresas set situacao = case when p_suspender then 'suspensa' else 'ativa' end,
    suspensa_em = case when p_suspender then now() end, motivo_suspensao = case when p_suspender then trim(p_motivo) end
  where id = p_id;
  if not found then raise exception 'empresa_nao_encontrada' using errcode = 'P0002'; end if;
end;
$$;

-- Administradores de uma empresa (para o super admin saber quem é o contato e reenviar convite)
create or replace function public.super_admins_da_empresa(p_empresa uuid)
returns table (user_id uuid, nome text, email text, ativo boolean, confirmado boolean, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.so_super_admin();
  return query select m.user_id, m.nome, u.email::text, m.ativo, u.email_confirmed_at is not null, u.last_sign_in_at
  from public.membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and m.perfil = 'admin' and m.suporte_ate is null order by m.nome;
end;
$$;

-- Usada pela função de convite: vincula a pessoa como admin, registrada na auditoria como feita pelo super admin
create or replace function public.super_vincular_admin(p_empresa uuid, p_user uuid, p_nome text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform app.so_super_admin();
  if coalesce(trim(p_nome), '') = '' then raise exception 'nome_obrigatorio' using errcode = 'P0001'; end if;
  insert into public.membros (empresa_id, user_id, perfil, nome) values (p_empresa, p_user, 'admin', trim(p_nome))
  on conflict (empresa_id, user_id, perfil) do update set ativo = true, nome = excluded.nome, suporte_ate = null, suporte_motivo = null;
end;
$$;

create or replace function public.super_lista_super_admins()
returns table (user_id uuid, nome text, email text, criado_em timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.so_super_admin();
  return query select s.user_id, s.nome, u.email::text, s.criado_em, u.last_sign_in_at
  from public.super_admins s join auth.users u on u.id = s.user_id order by s.criado_em;
end;
$$;

create or replace function public.super_adicionar_super_admin(p_email text, p_nome text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_u uuid;
begin
  perform app.so_super_admin();
  select id into v_u from auth.users where lower(email) = lower(trim(p_email));
  if v_u is null then raise exception 'usuario_nao_encontrado' using errcode = 'P0002'; end if;
  insert into public.super_admins (user_id, nome, criado_por) values (v_u, nullif(trim(p_nome), ''), (select auth.uid()))
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.super_remover_super_admin(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform app.so_super_admin();
  if p_user = (select auth.uid()) then raise exception 'nao_pode_remover_a_si_mesmo' using errcode = 'P0001'; end if;
  delete from public.super_admins where user_id = p_user;
end;
$$;

create trigger auditar_super_admins after insert or update or delete on public.super_admins
  for each row execute function app.auditar();

-- Rotina: apaga os vínculos de suporte vencidos
select cron.schedule('carpool-suporte', '*/5 * * * *', $$delete from public.membros where suporte_ate is not null and suporte_ate <= now()$$);

-- ---------------------------------------------------------------- permissões
revoke all on function app.eh_super_admin(), app.modulo_ativo(uuid, text), app.exigir_modulo(uuid, text) from public, anon;
grant execute on function app.eh_super_admin(), app.modulo_ativo(uuid, text), app.exigir_modulo(uuid, text) to authenticated;
revoke all on function app.cnpj_valido(text) from public, anon;
grant execute on function app.cnpj_valido(text) to authenticated;
revoke all on function app.empresa_campos_do_super(), app.conferir_empresa_e_plano(), app.conferir_modulo(), app.so_super_admin()
  from public, anon, authenticated;
revoke all on function public.sou_super_admin(), public.super_entrar_como(uuid, text), public.super_sair_suporte(), public.super_empresas(),
  public.super_salvar_empresa(uuid, text, text, text, text[], int, int, int), public.super_suspender_empresa(uuid, boolean, text),
  public.super_admins_da_empresa(uuid), public.super_vincular_admin(uuid, uuid, text), public.super_lista_super_admins(),
  public.super_adicionar_super_admin(text, text), public.super_remover_super_admin(uuid) from public, anon;
grant execute on function public.sou_super_admin(), public.super_entrar_como(uuid, text), public.super_sair_suporte(), public.super_empresas(),
  public.super_salvar_empresa(uuid, text, text, text, text[], int, int, int), public.super_suspender_empresa(uuid, boolean, text),
  public.super_admins_da_empresa(uuid), public.super_vincular_admin(uuid, uuid, text), public.super_lista_super_admins(),
  public.super_adicionar_super_admin(text, text), public.super_remover_super_admin(uuid) to authenticated;
