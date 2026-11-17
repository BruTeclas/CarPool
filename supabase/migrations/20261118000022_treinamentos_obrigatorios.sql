-- Treinamentos e comunicados, parte 3: obrigatoriedade, prazo, validade, bloqueio, acompanhamento e certificado.
-- Um treinamento com bloqueio <> 'nenhum' é obrigatório para o seu público. A aprovação vale para todas as
-- versões do mesmo treinamento (família). Prazo: conta da publicação (ou da entrada da pessoa na empresa,
-- se for depois) + prazo_dias. Com validade, ao vencer volta a ser pendente na hora (o aviso vem 30 dias antes)
-- e o conteúdo precisa ser refeito.

-- ---------------------------------------------------------------- situação de cada pessoa
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
    and app.publico_inclui(t.empresa_id, t.publico_perfis, t.publico_grupos, t.unidade_id, p_user)
$$;

-- Reciclagem: se a aprovação venceu, a matrícula abre um ciclo novo e o conteúdo é refeito
create or replace function app.matricula(p_treinamento uuid, p_user uuid)
returns public.treinamento_matriculas language plpgsql security definer set search_path = ''
as $$
declare v_m public.treinamento_matriculas; v_t public.treinamentos;
begin
  select * into v_t from public.treinamentos where id = p_treinamento;
  if not found or not app.pode_fazer_treinamento(v_t, p_user) then raise exception 'treinamento_indisponivel' using errcode = 'P0001'; end if;
  insert into public.treinamento_matriculas (treinamento_id, user_id, empresa_id) values (v_t.id, p_user, v_t.empresa_id)
  on conflict do nothing;
  select * into v_m from public.treinamento_matriculas where treinamento_id = v_t.id and user_id = p_user for update;
  if v_m.aprovado_em is not null and v_m.valido_ate is not null and v_m.valido_ate <= now()
     and v_m.conteudo_concluido_em is not null and v_m.conteudo_concluido_em <= v_m.aprovado_em then
    update public.treinamento_matriculas set ciclo = ciclo + 1, conteudo_concluido_em = null
    where treinamento_id = v_t.id and user_id = p_user returning * into v_m;
  end if;
  return v_m;
end;
$$;

-- ---------------------------------------------------------------- bloqueios
create or replace function app.conferir_treinamentos_da_reserva()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_titulo text;
begin
  if tg_op = 'INSERT' then
    select o.titulo into v_titulo from app.treinamentos_obrigatorios(new.empresa_id, new.motorista_id) o
    where o.bloqueando and o.bloqueio in ('reservas', 'reservas_e_retiradas') limit 1;
  elsif new.status in ('liberada', 'em_uso') and new.status is distinct from old.status then
    select o.titulo into v_titulo from app.treinamentos_obrigatorios(new.empresa_id, new.motorista_id) o
    where o.bloqueando and o.bloqueio = 'reservas_e_retiradas' limit 1;
  end if;
  if v_titulo is not null then raise exception 'treinamento_pendente: %', v_titulo using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger reservas_conferir_treinamentos before insert or update of status on public.reservas
  for each row execute function app.conferir_treinamentos_da_reserva();

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
      where p.pendente and (p.c).nivel = 'bloqueante'), '[]'::jsonb),
    'treinamentos', coalesce((select jsonb_agg(jsonb_build_object('id', o.treinamento_id, 'titulo', o.titulo, 'prazo_ate', o.prazo_ate, 'vencido', o.aprovado_em is not null))
      from app.treinamentos_obrigatorios(p_empresa, (select auth.uid())) o
      where o.bloqueando and o.bloqueio in ('reservas', 'reservas_e_retiradas')), '[]'::jsonb)
  )
  where p_empresa in (select app.empresas_do_usuario())
$$;

-- ---------------------------------------------------------------- lista do colaborador (com obrigatoriedade e prazo)
create or replace function public.meus_treinamentos(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'titulo', t.titulo, 'descricao', t.descricao, 'versao', t.versao, 'nota_minima', t.nota_minima,
      'tentativas', t.tentativas, 'validade_meses', t.validade_meses, 'bloqueio', t.bloqueio,
      'obrigatorio', o.treinamento_id is not null, 'prazo_ate', o.prazo_ate, 'em_dia', o.em_dia, 'bloqueando', coalesce(o.bloqueando, false),
      'etapas', (select count(*) from public.treinamento_etapas e where e.treinamento_id = t.id),
      'minutos', (select ceil(sum(e.tempo_minimo_seg) / 60.0) from public.treinamento_etapas e where e.treinamento_id = t.id),
      'concluidas', (select count(*) from public.treinamento_progresso pr where pr.treinamento_id = t.id and pr.user_id = (select auth.uid())
                      and pr.ciclo = coalesce(m.ciclo, 1) and pr.concluida_em is not null),
      'ciclo', coalesce(m.ciclo, 1), 'conteudo_concluido_em', m.conteudo_concluido_em,
      'aprovado_em', coalesce(o.aprovado_em, m.aprovado_em), 'nota', coalesce(o.nota, m.nota), 'valido_ate', coalesce(o.valido_ate, m.valido_ate),
      'aguardando_correcao', exists (select 1 from public.treinamento_tentativas x where x.treinamento_id = t.id and x.user_id = (select auth.uid())
                                     and x.status = 'aguardando_correcao'))
    order by coalesce(o.bloqueando, false) desc, (o.treinamento_id is not null and not o.em_dia) desc, o.prazo_ate nulls last, t.titulo), '[]'::jsonb)
  from public.treinamentos t
  left join public.treinamento_matriculas m on m.treinamento_id = t.id and m.user_id = (select auth.uid())
  left join app.treinamentos_obrigatorios(p_empresa, (select auth.uid())) o on o.treinamento_id = t.id
  where t.empresa_id = p_empresa and p_empresa in (select app.empresas_do_usuario())
    and app.pode_fazer_treinamento(t, (select auth.uid()))
$$;

-- ---------------------------------------------------------------- acompanhamento do gestor
create or replace function public.acompanhamento_treinamento(p_treinamento uuid)
returns table (user_id uuid, nome text, situacao text, prazo_ate timestamptz, etapas_concluidas int, etapas int,
               segundos int, tentativas int, ultima_nota numeric, aprovado_em timestamptz, valido_ate timestamptz, nota numeric,
               tempo_por_etapa jsonb)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_t public.treinamentos;
begin
  select * into v_t from public.treinamentos where id = p_treinamento;
  if not found or not app.pode_gerir_treinamento(v_t.empresa_id) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return query
  with pessoas as (
    select distinct on (m.user_id) m.user_id, m.nome, m.criado_em from public.membros m
    where m.empresa_id = v_t.empresa_id and m.ativo
      and app.publico_inclui(v_t.empresa_id, v_t.publico_perfis, v_t.publico_grupos, v_t.unidade_id, m.user_id)
    order by m.user_id, m.criado_em
  )
  select p.user_id, p.nome,
    case
      when ap.aprovado_em is not null and (ap.valido_ate is null or ap.valido_ate > now() + interval '30 days') then 'aprovado'
      when ap.aprovado_em is not null and ap.valido_ate > now() then 'vencendo'
      when exists (select 1 from public.treinamento_tentativas x join public.treinamentos t2 on t2.id = x.treinamento_id
                   where t2.familia_id = v_t.familia_id and x.user_id = p.user_id and x.status = 'aguardando_correcao') then 'aguardando_correcao'
      when ap.aprovado_em is not null then 'vencido'
      when v_t.bloqueio <> 'nenhum' and prazo.ate <= now() then 'atrasado'
      when mt.treinamento_id is not null then 'em_andamento'
      else 'nao_iniciado'
    end,
    case when v_t.bloqueio <> 'nenhum' then coalesce(case when ap.aprovado_em is not null then ap.valido_ate end, case when ap.aprovado_em is null then prazo.ate end) end,
    (select count(*)::int from public.treinamento_progresso pr where pr.treinamento_id = v_t.id and pr.user_id = p.user_id
       and pr.ciclo = coalesce(mt.ciclo, 1) and pr.concluida_em is not null),
    (select count(*)::int from public.treinamento_etapas e where e.treinamento_id = v_t.id),
    (select coalesce(round(sum(pr.segundos)), 0)::int from public.treinamento_progresso pr join public.treinamentos t2 on t2.id = pr.treinamento_id
       where t2.familia_id = v_t.familia_id and pr.user_id = p.user_id),
    (select count(*)::int from public.treinamento_tentativas x join public.treinamentos t2 on t2.id = x.treinamento_id
       where t2.familia_id = v_t.familia_id and x.user_id = p.user_id and x.status <> 'em_andamento'),
    (select x.nota from public.treinamento_tentativas x join public.treinamentos t2 on t2.id = x.treinamento_id
       where t2.familia_id = v_t.familia_id and x.user_id = p.user_id and x.nota is not null order by x.enviada_em desc limit 1),
    ap.aprovado_em, ap.valido_ate, ap.nota,
    (select jsonb_agg(jsonb_build_object('etapa', e.titulo, 'segundos', round(coalesce(pr.segundos, 0)), 'concluida_em', pr.concluida_em) order by e.ordem)
       from public.treinamento_etapas e
       left join public.treinamento_progresso pr on pr.etapa_id = e.id and pr.user_id = p.user_id and pr.ciclo = coalesce(mt.ciclo, 1)
       where e.treinamento_id = v_t.id)
  from pessoas p
  left join public.treinamento_matriculas mt on mt.treinamento_id = v_t.id and mt.user_id = p.user_id
  left join lateral (
    select m.aprovado_em, m.valido_ate, m.nota from public.treinamento_matriculas m join public.treinamentos t2 on t2.id = m.treinamento_id
    where t2.familia_id = v_t.familia_id and m.user_id = p.user_id and m.aprovado_em is not null order by m.aprovado_em desc limit 1
  ) ap on true
  cross join lateral (
    select greatest((select min(t3.publicado_em) from public.treinamentos t3 where t3.familia_id = v_t.familia_id), p.criado_em)
           + make_interval(days => v_t.prazo_dias) as ate
  ) prazo
  order by 3, p.nome;
end;
$$;

-- ---------------------------------------------------------------- certificado
create or replace function public.certificado_treinamento(p_treinamento uuid, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_t public.treinamentos; v_u uuid := coalesce(p_user, (select auth.uid())); v_x public.treinamento_tentativas; v_m public.treinamento_matriculas;
begin
  select * into v_t from public.treinamentos where id = p_treinamento;
  if not found or (v_u <> (select auth.uid()) and not app.pode_gerir_treinamento(v_t.empresa_id))
     or v_t.empresa_id not in (select app.empresas_do_usuario()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  -- a aprovação mais recente em qualquer versão do mesmo treinamento
  select m.* into v_m from public.treinamento_matriculas m join public.treinamentos t2 on t2.id = m.treinamento_id
  where t2.familia_id = v_t.familia_id and m.user_id = v_u and m.aprovado_em is not null order by m.aprovado_em desc limit 1;
  if v_m.aprovado_em is null then raise exception 'treinamento_nao_aprovado' using errcode = 'P0001'; end if;
  select * into v_t from public.treinamentos where id = v_m.treinamento_id;
  select * into v_x from public.treinamento_tentativas where treinamento_id = v_t.id and user_id = v_u and status = 'aprovada'
  order by coalesce(corrigida_em, enviada_em) desc limit 1;
  return jsonb_build_object(
    'nome', (select m.nome from public.membros m where m.empresa_id = v_t.empresa_id and m.user_id = v_u order by m.criado_em limit 1),
    'empresa', (select e.nome from public.empresas e where e.id = v_t.empresa_id),
    'treinamento', v_t.titulo, 'versao', v_t.versao, 'nota', v_m.nota, 'nota_minima', v_t.nota_minima,
    'aprovado_em', v_m.aprovado_em, 'valido_ate', v_m.valido_ate,
    'segundos', (select coalesce(round(sum(pr.segundos)), 0) from public.treinamento_progresso pr where pr.treinamento_id = v_t.id and pr.user_id = v_u),
    'etapas', (select jsonb_agg(jsonb_build_object('titulo', e.titulo, 'tipo', e.tipo) order by e.ordem) from public.treinamento_etapas e where e.treinamento_id = v_t.id),
    'codigo', upper(substr(replace(v_x.id::text, '-', ''), 1, 12)),
    'tentativa_id', v_x.id
  );
end;
$$;

-- ---------------------------------------------------------------- avisos
-- Ao publicar um obrigatório, avisa quem precisa fazer
create or replace function public.publicar_treinamento(p_treinamento uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t public.treinamentos;
begin
  select * into v_t from public.treinamentos where id = p_treinamento for update;
  if not found or not app.pode_gerir_treinamento(v_t.empresa_id) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if v_t.publicado_em is not null then raise exception 'treinamento_ja_publicado' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.treinamento_etapas where treinamento_id = v_t.id) then
    raise exception 'treinamento_sem_etapas' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.treinamento_perguntas where treinamento_id = v_t.id) then
    raise exception 'treinamento_sem_prova' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.treinamento_perguntas p where p.treinamento_id = v_t.id and p.tipo <> 'escrita'
             and ((select count(*) from public.treinamento_alternativas a where a.pergunta_id = p.id) < 2
                  or (select count(*) from public.treinamento_alternativas a where a.pergunta_id = p.id and a.correta) = 0
                  or (p.tipo in ('unica', 'vf') and (select count(*) from public.treinamento_alternativas a where a.pergunta_id = p.id and a.correta) <> 1))) then
    raise exception 'pergunta_sem_gabarito' using errcode = 'P0001';
  end if;
  update public.treinamentos set publicado_em = now(), ativo = true where id = v_t.id;
  update public.treinamentos set ativo = false where familia_id = v_t.familia_id and id <> v_t.id and ativo;
  if v_t.bloqueio <> 'nenhum' then
    perform app.notificar(v_t.empresa_id, p.user_id, 'treinamento', 'Treinamento obrigatório: ' || v_t.titulo,
      case when o.prazo_ate <= now() then 'Faça o treinamento para continuar reservando veículos.'
           else 'Faça até ' || to_char(o.prazo_ate at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '. Depois disso, as reservas ficam bloqueadas.' end,
      null, true)
    from (select distinct m.user_id from public.membros m where m.empresa_id = v_t.empresa_id and m.ativo) p
    cross join lateral app.treinamentos_obrigatorios(v_t.empresa_id, p.user_id) o
    where o.treinamento_id = v_t.id and not o.em_dia;
  end if;
end;
$$;

-- Rotina diária: prazo chegando (7, 1 e 0 dias) e reciclagem (30, 7 e 1 dia antes de vencer)
create or replace function app.rotina_treinamentos()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r record; n int := 0; v_dias int;
begin
  for r in
    select m.empresa_id, m.user_id, o.*
    from (select distinct empresa_id, user_id from public.membros where ativo) m
    cross join lateral app.treinamentos_obrigatorios(m.empresa_id, m.user_id) o
    where o.prazo_ate is not null
  loop
    v_dias := (r.prazo_ate at time zone 'America/Sao_Paulo')::date - (now() at time zone 'America/Sao_Paulo')::date;
    if not r.em_dia and v_dias in (7, 1, 0) then
      perform app.notificar(r.empresa_id, r.user_id, 'treinamento', 'Prazo do treinamento ' || r.titulo,
        case when v_dias = 0 then 'O prazo termina hoje. Depois, as reservas ficam bloqueadas.'
             else 'Faltam ' || v_dias || case when v_dias = 1 then ' dia' else ' dias' end || ' para o prazo terminar.' end, null, true);
      n := n + 1;
    elsif r.em_dia and v_dias in (30, 7, 1) then
      perform app.notificar(r.empresa_id, r.user_id, 'treinamento', 'Reciclagem: ' || r.titulo,
        'Sua aprovação vence em ' || v_dias || case when v_dias = 1 then ' dia' else ' dias' end || '. Refaça o treinamento para não ter as reservas bloqueadas.', null, v_dias <= 7);
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('avisos', n);
end;
$$;

select cron.schedule('carpool-treinamentos', '17 11 * * *', 'select app.rotina_treinamentos()');

revoke all on function app.treinamentos_obrigatorios(uuid, uuid), app.conferir_treinamentos_da_reserva(), app.rotina_treinamentos()
  from public, anon, authenticated;
revoke all on function public.acompanhamento_treinamento(uuid), public.certificado_treinamento(uuid, uuid) from public, anon;
grant execute on function public.acompanhamento_treinamento(uuid), public.certificado_treinamento(uuid, uuid) to authenticated;
