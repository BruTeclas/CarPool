-- Treinamentos e comunicados, parte 2: treinamentos.
-- O gestor monta um treinamento (rascunho) com etapas em ordem (vídeo do YouTube, vídeo enviado,
-- texto, PDF), cada uma com tempo mínimo, e uma prova. Ao publicar, o conteúdo congela; para mudar,
-- cria-se uma nova versão. O tempo de cada etapa é contado no servidor (telemetria): só conta tempo
-- real, com a tela à vista, sem adiantar o vídeo e com confirmação de presença periódica.

-- ---------------------------------------------------------------- estrutura
create table public.treinamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  familia_id uuid not null,               -- igual em todas as versões do mesmo treinamento
  versao int not null default 1 check (versao > 0),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  descricao text check (descricao is null or length(descricao) <= 2000),
  nota_minima int not null default 70 check (nota_minima between 0 and 100),
  tentativas int not null default 3 check (tentativas between 1 and 10),
  embaralhar boolean not null default true,
  -- público, validade e bloqueio (usados na parte 3)
  publico_perfis public.perfil_membro[],
  publico_grupos uuid[],
  unidade_id uuid references public.unidades(id) on delete set null,
  validade_meses int check (validade_meses is null or validade_meses between 1 and 120),
  bloqueio text not null default 'reservas' check (bloqueio in ('nenhum', 'reservas', 'reservas_e_retiradas')),
  prazo_dias int not null default 15 check (prazo_dias between 0 and 365),
  publicado_em timestamptz,
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (familia_id, versao)
);
create index on public.treinamentos (empresa_id);
create index on public.treinamentos (unidade_id);
create index on public.treinamentos (criado_por);

create table public.treinamento_etapas (
  id uuid primary key default gen_random_uuid(),
  treinamento_id uuid not null references public.treinamentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem int not null,
  tipo text not null check (tipo in ('youtube', 'video', 'texto', 'pdf')),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  arquivo_caminho text,
  texto text check (texto is null or length(texto) <= 50000),
  duracao_seg int check (duracao_seg is null or duracao_seg > 0),
  tempo_minimo_seg int not null default 60 check (tempo_minimo_seg between 10 and 14400),
  check (tipo <> 'youtube' or youtube_id is not null),
  check (tipo not in ('video', 'pdf') or arquivo_caminho is not null),
  check (tipo <> 'texto' or length(trim(coalesce(texto, ''))) > 0)
);
create index on public.treinamento_etapas (treinamento_id, ordem);
create index on public.treinamento_etapas (empresa_id);

create table public.treinamento_perguntas (
  id uuid primary key default gen_random_uuid(),
  treinamento_id uuid not null references public.treinamentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem int not null,
  tipo text not null check (tipo in ('unica', 'multipla', 'vf', 'escrita')),
  enunciado text not null check (length(trim(enunciado)) between 1 and 2000),
  peso int not null default 1 check (peso between 1 and 10)
);
create index on public.treinamento_perguntas (treinamento_id, ordem);
create index on public.treinamento_perguntas (empresa_id);

create table public.treinamento_alternativas (
  id uuid primary key default gen_random_uuid(),
  pergunta_id uuid not null references public.treinamento_perguntas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem int not null,
  texto text not null check (length(trim(texto)) between 1 and 500),
  correta boolean not null default false
);
create index on public.treinamento_alternativas (pergunta_id, ordem);
create index on public.treinamento_alternativas (empresa_id);

-- Uma linha por pessoa e treinamento. "ciclo" sobe quando as tentativas da prova acabam:
-- a pessoa refaz o conteúdo antes de tentar de novo.
create table public.treinamento_matriculas (
  treinamento_id uuid not null references public.treinamentos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ciclo int not null default 1,
  iniciado_em timestamptz not null default now(),
  conteudo_concluido_em timestamptz,
  aprovado_em timestamptz,
  nota numeric(5,2),
  valido_ate timestamptz,
  primary key (treinamento_id, user_id)
);
create index on public.treinamento_matriculas (user_id);
create index on public.treinamento_matriculas (empresa_id);

-- Telemetria por etapa: segundos já validados, pendentes (aguardando confirmação de presença),
-- ponto mais adiantado do vídeo e o último sinal recebido
create table public.treinamento_progresso (
  etapa_id uuid not null references public.treinamento_etapas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciclo int not null,
  treinamento_id uuid not null references public.treinamentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  segundos numeric not null default 0,
  pendentes numeric not null default 0,
  posicao_max numeric not null default 0,
  ultima_posicao numeric,
  fim_alcancado boolean not null default false,
  sessao uuid,
  ultimo_sinal_em timestamptz,
  presenca_em timestamptz,
  iniciado_em timestamptz not null default now(),
  concluida_em timestamptz,
  primary key (etapa_id, user_id, ciclo)
);
create index on public.treinamento_progresso (user_id, treinamento_id);
create index on public.treinamento_progresso (treinamento_id);
create index on public.treinamento_progresso (empresa_id);

create table public.treinamento_tentativas (
  id uuid primary key default gen_random_uuid(),
  treinamento_id uuid not null references public.treinamentos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ciclo int not null,
  numero int not null,
  perguntas jsonb not null,               -- a prova como foi mostrada (ordem sorteada, sem gabarito)
  respostas jsonb,
  pontos_auto numeric,
  correcao jsonb,                         -- pontos das respostas escritas, dados pelo gestor
  nota numeric(5,2),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'aguardando_correcao', 'aprovada', 'reprovada')),
  iniciada_em timestamptz not null default now(),
  enviada_em timestamptz,
  corrigida_por uuid references auth.users(id) on delete set null,
  corrigida_em timestamptz,
  comentario text,
  unique (treinamento_id, user_id, ciclo, numero)
);
create index on public.treinamento_tentativas (user_id);
create index on public.treinamento_tentativas (empresa_id, status);
create index on public.treinamento_tentativas (corrigida_por);

-- ---------------------------------------------------------------- regras de edição
create or replace function app.pode_gerir_treinamento(p_empresa uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.tem_perfil(p_empresa, array['admin', 'gestor_frota']::public.perfil_membro[]) $$;

create or replace function app.treinamento_em_rascunho(p_treinamento uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.treinamentos t where t.id = p_treinamento and t.publicado_em is null) $$;

-- Publicado: título, prova e regras de aprovação congelam (público, validade e bloqueio podem mudar)
create or replace function app.treinamento_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.publicado_em is not null and (
       new.titulo, new.descricao, new.nota_minima, new.tentativas, new.embaralhar, new.versao, new.familia_id, new.empresa_id, new.publicado_em
     ) is distinct from (
       old.titulo, old.descricao, old.nota_minima, old.tentativas, old.embaralhar, old.versao, old.familia_id, old.empresa_id, old.publicado_em) then
    raise exception 'treinamento_publicado_nao_muda' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger treinamentos_imutavel before update on public.treinamentos
  for each row execute function app.treinamento_imutavel();

create or replace function app.treinamento_publicado_bloqueia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_t uuid;
begin
  if tg_table_name = 'treinamento_alternativas' then
    select p.treinamento_id into v_t from public.treinamento_perguntas p where p.id = coalesce(new.pergunta_id, old.pergunta_id);
  else
    v_t := coalesce(new.treinamento_id, old.treinamento_id);
  end if;
  if not app.treinamento_em_rascunho(v_t) and exists (select 1 from public.treinamentos where id = v_t) then
    raise exception 'treinamento_publicado_nao_muda' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger etapas_congeladas before insert or update or delete on public.treinamento_etapas
  for each row execute function app.treinamento_publicado_bloqueia();
create trigger perguntas_congeladas before insert or update or delete on public.treinamento_perguntas
  for each row execute function app.treinamento_publicado_bloqueia();
create trigger alternativas_congeladas before insert or update or delete on public.treinamento_alternativas
  for each row execute function app.treinamento_publicado_bloqueia();

-- Público genérico (perfis, grupos e filial se somam; nulo = sem filtro)
create or replace function app.publico_inclui(p_empresa uuid, p_perfis public.perfil_membro[], p_grupos uuid[], p_unidade uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = p_user and m.ativo
                 and (p_perfis is null or m.perfil = any (p_perfis)))
     and (p_grupos is null or exists (select 1 from public.grupo_membros g where g.user_id = p_user and g.grupo_id = any (p_grupos)))
     and (p_unidade is null or exists (select 1 from public.membro_unidades mu where mu.user_id = p_user and mu.unidade_id = p_unidade))
$$;

create or replace function app.pode_fazer_treinamento(t public.treinamentos, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select t.publicado_em is not null and t.ativo
     and app.publico_inclui(t.empresa_id, t.publico_perfis, t.publico_grupos, t.unidade_id, p_user)
$$;

-- ---------------------------------------------------------------- publicar e nova versão
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
  -- toda pergunta objetiva precisa de alternativas e de gabarito coerente
  if exists (select 1 from public.treinamento_perguntas p where p.treinamento_id = v_t.id and p.tipo <> 'escrita'
             and ((select count(*) from public.treinamento_alternativas a where a.pergunta_id = p.id) < 2
                  or (select count(*) from public.treinamento_alternativas a where a.pergunta_id = p.id and a.correta) = 0
                  or (p.tipo in ('unica', 'vf') and (select count(*) from public.treinamento_alternativas a where a.pergunta_id = p.id and a.correta) <> 1))) then
    raise exception 'pergunta_sem_gabarito' using errcode = 'P0001';
  end if;
  update public.treinamentos set publicado_em = now(), ativo = true where id = v_t.id;
  -- versões anteriores saem do ar
  update public.treinamentos set ativo = false where familia_id = v_t.familia_id and id <> v_t.id and ativo;
end;
$$;

create or replace function public.nova_versao_treinamento(p_treinamento uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_t public.treinamentos; v_novo uuid := gen_random_uuid(); r record; v_p uuid;
begin
  select * into v_t from public.treinamentos where id = p_treinamento;
  if not found or not app.pode_gerir_treinamento(v_t.empresa_id) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if exists (select 1 from public.treinamentos where familia_id = v_t.familia_id and publicado_em is null) then
    raise exception 'ja_existe_rascunho' using errcode = 'P0001';
  end if;
  insert into public.treinamentos (id, empresa_id, familia_id, versao, titulo, descricao, nota_minima, tentativas, embaralhar,
    publico_perfis, publico_grupos, unidade_id, validade_meses, bloqueio, prazo_dias, ativo, criado_por)
  select v_novo, empresa_id, familia_id, (select max(versao) + 1 from public.treinamentos where familia_id = v_t.familia_id),
    titulo, descricao, nota_minima, tentativas, embaralhar, publico_perfis, publico_grupos, unidade_id, validade_meses, bloqueio, prazo_dias,
    false, (select auth.uid())
  from public.treinamentos where id = v_t.id;
  insert into public.treinamento_etapas (treinamento_id, empresa_id, ordem, tipo, titulo, youtube_id, arquivo_caminho, texto, duracao_seg, tempo_minimo_seg)
  select v_novo, empresa_id, ordem, tipo, titulo, youtube_id, arquivo_caminho, texto, duracao_seg, tempo_minimo_seg
  from public.treinamento_etapas where treinamento_id = v_t.id;
  for r in select * from public.treinamento_perguntas where treinamento_id = v_t.id loop
    insert into public.treinamento_perguntas (treinamento_id, empresa_id, ordem, tipo, enunciado, peso)
    values (v_novo, r.empresa_id, r.ordem, r.tipo, r.enunciado, r.peso) returning id into v_p;
    insert into public.treinamento_alternativas (pergunta_id, empresa_id, ordem, texto, correta)
    select v_p, empresa_id, ordem, texto, correta from public.treinamento_alternativas where pergunta_id = r.id;
  end loop;
  return v_novo;
end;
$$;

-- ---------------------------------------------------------------- do lado do colaborador
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
  return v_m;
end;
$$;

-- Treinamentos disponíveis para a pessoa, com a situação dela
create or replace function public.meus_treinamentos(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'titulo', t.titulo, 'descricao', t.descricao, 'versao', t.versao, 'nota_minima', t.nota_minima,
      'tentativas', t.tentativas, 'validade_meses', t.validade_meses,
      'etapas', (select count(*) from public.treinamento_etapas e where e.treinamento_id = t.id),
      'minutos', (select ceil(sum(e.tempo_minimo_seg) / 60.0) from public.treinamento_etapas e where e.treinamento_id = t.id),
      'concluidas', (select count(*) from public.treinamento_progresso pr where pr.treinamento_id = t.id and pr.user_id = (select auth.uid())
                      and pr.ciclo = coalesce(m.ciclo, 1) and pr.concluida_em is not null),
      'ciclo', coalesce(m.ciclo, 1), 'conteudo_concluido_em', m.conteudo_concluido_em, 'aprovado_em', m.aprovado_em,
      'nota', m.nota, 'valido_ate', m.valido_ate,
      'aguardando_correcao', exists (select 1 from public.treinamento_tentativas x where x.treinamento_id = t.id and x.user_id = (select auth.uid())
                                     and x.status = 'aguardando_correcao'))
    order by (m.aprovado_em is not null), t.titulo), '[]'::jsonb)
  from public.treinamentos t
  left join public.treinamento_matriculas m on m.treinamento_id = t.id and m.user_id = (select auth.uid())
  where t.empresa_id = p_empresa and p_empresa in (select app.empresas_do_usuario())
    and app.pode_fazer_treinamento(t, (select auth.uid()))
$$;

-- Conteúdo para estudar: etapas com o progresso da pessoa no ciclo atual (sem o gabarito da prova)
create or replace function public.conteudo_treinamento(p_treinamento uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_t public.treinamentos; v_m public.treinamento_matriculas; v_uid uuid := (select auth.uid());
begin
  select * into v_t from public.treinamentos where id = p_treinamento;
  if not found then raise exception 'treinamento_indisponivel' using errcode = 'P0001'; end if;
  v_m := app.matricula(p_treinamento, v_uid);
  return jsonb_build_object(
    'treinamento', to_jsonb(v_t) - 'publico_perfis' - 'publico_grupos' - 'criado_por',
    'matricula', to_jsonb(v_m),
    'perguntas', (select count(*) from public.treinamento_perguntas where treinamento_id = v_t.id),
    'tentativas_usadas', (select count(*) from public.treinamento_tentativas x where x.treinamento_id = v_t.id and x.user_id = v_uid
                          and x.ciclo = v_m.ciclo and x.status <> 'em_andamento'),
    'tentativas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'numero', x.numero, 'ciclo', x.ciclo, 'nota', x.nota,
                    'status', x.status, 'enviada_em', x.enviada_em, 'comentario', x.comentario) order by x.iniciada_em), '[]'::jsonb)
                   from public.treinamento_tentativas x where x.treinamento_id = v_t.id and x.user_id = v_uid),
    'etapas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'ordem', e.ordem, 'tipo', e.tipo, 'titulo', e.titulo, 'youtube_id', e.youtube_id,
                  'arquivo_caminho', e.arquivo_caminho, 'texto', e.texto, 'duracao_seg', e.duracao_seg, 'tempo_minimo_seg', e.tempo_minimo_seg,
                  'segundos', coalesce(pr.segundos, 0), 'pendentes', coalesce(pr.pendentes, 0), 'posicao_max', coalesce(pr.posicao_max, 0),
                  'fim_alcancado', coalesce(pr.fim_alcancado, false), 'concluida_em', pr.concluida_em) order by e.ordem), '[]'::jsonb)
               from public.treinamento_etapas e
               left join public.treinamento_progresso pr on pr.etapa_id = e.id and pr.user_id = v_uid and pr.ciclo = v_m.ciclo
               where e.treinamento_id = v_t.id)
  );
end;
$$;

-- Telemetria: o app manda um sinal a cada ~5 s enquanto a etapa está aberta e à vista.
-- O servidor credita no máximo o tempo real decorrido, só o trecho novo do vídeo (sem adiantar,
-- velocidade 1x) e deixa o tempo "pendente" até a pessoa confirmar presença.
create or replace function public.sinal_etapa(p_etapa uuid, p_sessao uuid, p_posicao numeric, p_tocando boolean, p_fim boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_agora timestamptz := clock_timestamp();
  v_e public.treinamento_etapas; v_m public.treinamento_matriculas; v_p public.treinamento_progresso;
  v_delta numeric := 0; v_credito numeric := 0; v_permitida numeric; v_video boolean; v_pos numeric := greatest(coalesce(p_posicao, 0), 0);
begin
  select * into v_e from public.treinamento_etapas where id = p_etapa;
  if not found then raise exception 'treinamento_indisponivel' using errcode = 'P0001'; end if;
  v_m := app.matricula(v_e.treinamento_id, v_uid);
  if exists (select 1 from public.treinamento_etapas a where a.treinamento_id = v_e.treinamento_id and a.ordem < v_e.ordem
             and not exists (select 1 from public.treinamento_progresso pr where pr.etapa_id = a.id and pr.user_id = v_uid
                             and pr.ciclo = v_m.ciclo and pr.concluida_em is not null)) then
    raise exception 'etapa_bloqueada' using errcode = 'P0001';
  end if;
  insert into public.treinamento_progresso (etapa_id, user_id, ciclo, treinamento_id, empresa_id)
  values (v_e.id, v_uid, v_m.ciclo, v_e.treinamento_id, v_e.empresa_id) on conflict do nothing;
  select * into v_p from public.treinamento_progresso where etapa_id = v_e.id and user_id = v_uid and ciclo = v_m.ciclo for update;
  v_video := v_e.tipo in ('youtube', 'video');

  if v_p.concluida_em is null then
    if v_p.sessao is distinct from p_sessao or v_p.ultimo_sinal_em is null or v_agora - v_p.ultimo_sinal_em > interval '20 seconds' then
      -- nova sessão ou volta depois de uma pausa longa: recomeça a contagem a partir daqui
      v_p.sessao := p_sessao;
      v_p.ultima_posicao := least(v_pos, v_p.posicao_max);
      if v_p.presenca_em is null or v_agora - v_p.presenca_em > interval '6 minutes' then
        v_p.pendentes := 0; v_p.presenca_em := v_agora;   -- abrir e dar o play conta como presença
      end if;
    else
      v_delta := least(extract(epoch from v_agora - v_p.ultimo_sinal_em), 15);
    end if;

    if v_agora - v_p.presenca_em > interval '6 minutes' then
      v_p.pendentes := 0;                                 -- não confirmou a presença a tempo: o trecho não conta
    elsif v_video then
      if v_pos > v_p.posicao_max + v_delta + 3 then
        v_permitida := v_p.posicao_max;                   -- tentou adiantar: volta para o ponto já assistido
      else
        -- só conta trecho novo e tocado; tolerância de meio segundo por sinal para o atraso da rede
        if p_tocando and v_delta > 0 then
          v_credito := least(v_delta + 0.5, greatest(0, v_pos - v_p.posicao_max));
          v_p.posicao_max := greatest(v_p.posicao_max, v_pos);
        end if;
        v_p.ultima_posicao := v_pos;
      end if;
    else
      if p_tocando then v_credito := v_delta; end if;
      if p_fim then v_p.fim_alcancado := true; end if;
    end if;
    v_p.pendentes := v_p.pendentes + v_credito;
    v_p.ultimo_sinal_em := v_agora;
    update public.treinamento_progresso set sessao = v_p.sessao, ultima_posicao = v_p.ultima_posicao, posicao_max = v_p.posicao_max,
      pendentes = v_p.pendentes, presenca_em = v_p.presenca_em, fim_alcancado = v_p.fim_alcancado, ultimo_sinal_em = v_p.ultimo_sinal_em
    where etapa_id = v_p.etapa_id and user_id = v_uid and ciclo = v_m.ciclo;
  end if;

  return jsonb_build_object('segundos', v_p.segundos, 'pendentes', v_p.pendentes, 'minimo', v_e.tempo_minimo_seg,
    'posicao_max', v_p.posicao_max, 'posicao_permitida', v_permitida, 'concluida', v_p.concluida_em is not null,
    'pronta', v_p.concluida_em is null and v_p.segundos + v_p.pendentes >= v_e.tempo_minimo_seg - 1
              and (v_e.tipo not in ('texto', 'pdf') or v_p.fim_alcancado),
    'presenca_em', v_p.presenca_em);
end;
$$;

-- "Você está aí?": confirma a presença; o tempo pendente passa a valer. Conclui a etapa se chegou ao mínimo.
create or replace function public.confirmar_presenca(p_etapa uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_agora timestamptz := clock_timestamp();
  v_e public.treinamento_etapas; v_m public.treinamento_matriculas; v_p public.treinamento_progresso; v_concluiu boolean := false;
begin
  select * into v_e from public.treinamento_etapas where id = p_etapa;
  if not found then raise exception 'treinamento_indisponivel' using errcode = 'P0001'; end if;
  v_m := app.matricula(v_e.treinamento_id, v_uid);
  select * into v_p from public.treinamento_progresso where etapa_id = v_e.id and user_id = v_uid and ciclo = v_m.ciclo for update;
  if not found then raise exception 'etapa_nao_iniciada' using errcode = 'P0001'; end if;
  if v_p.concluida_em is null then
    if v_p.presenca_em is null or v_agora - v_p.presenca_em > interval '6 minutes' then
      v_p.pendentes := 0;                                 -- demorou demais: o trecho anterior não conta
    end if;
    v_p.segundos := v_p.segundos + v_p.pendentes;
    v_p.pendentes := 0;
    v_p.presenca_em := v_agora;
    if v_p.segundos >= v_e.tempo_minimo_seg - 1 and (v_e.tipo not in ('texto', 'pdf') or v_p.fim_alcancado) then
      v_p.concluida_em := v_agora; v_concluiu := true;
    end if;
    update public.treinamento_progresso set segundos = v_p.segundos, pendentes = 0, presenca_em = v_p.presenca_em, concluida_em = v_p.concluida_em
    where etapa_id = v_p.etapa_id and user_id = v_uid and ciclo = v_m.ciclo;
    if v_concluiu and not exists (
      select 1 from public.treinamento_etapas a where a.treinamento_id = v_e.treinamento_id
        and not exists (select 1 from public.treinamento_progresso pr where pr.etapa_id = a.id and pr.user_id = v_uid
                        and pr.ciclo = v_m.ciclo and pr.concluida_em is not null)) then
      update public.treinamento_matriculas set conteudo_concluido_em = v_agora
      where treinamento_id = v_e.treinamento_id and user_id = v_uid;
    end if;
  end if;
  return jsonb_build_object('segundos', v_p.segundos, 'minimo', v_e.tempo_minimo_seg, 'concluida', v_p.concluida_em is not null);
end;
$$;

-- ---------------------------------------------------------------- prova
create or replace function public.iniciar_prova(p_treinamento uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_t public.treinamentos; v_m public.treinamento_matriculas;
  v_x public.treinamento_tentativas; v_usadas int; v_perguntas jsonb;
begin
  select * into v_t from public.treinamentos where id = p_treinamento;
  v_m := app.matricula(p_treinamento, v_uid);
  if v_m.aprovado_em is not null and (v_m.valido_ate is null or v_m.valido_ate > now()) then raise exception 'treinamento_ja_aprovado' using errcode = 'P0001'; end if;
  if v_m.conteudo_concluido_em is null then raise exception 'conteudo_pendente' using errcode = 'P0001'; end if;
  if exists (select 1 from public.treinamento_tentativas where treinamento_id = v_t.id and user_id = v_uid and status = 'aguardando_correcao') then
    raise exception 'prova_em_correcao' using errcode = 'P0001';
  end if;
  select * into v_x from public.treinamento_tentativas
  where treinamento_id = v_t.id and user_id = v_uid and ciclo = v_m.ciclo and status = 'em_andamento';
  if found then return to_jsonb(v_x) - 'correcao' - 'pontos_auto'; end if;
  select count(*) into v_usadas from public.treinamento_tentativas where treinamento_id = v_t.id and user_id = v_uid and ciclo = v_m.ciclo;
  if v_usadas >= v_t.tentativas then raise exception 'tentativas_esgotadas' using errcode = 'P0001'; end if;

  select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'enunciado', p.enunciado, 'peso', p.peso,
           'alternativas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'texto', a.texto)
                                 order by case when v_t.embaralhar and p.tipo <> 'vf' then random() else a.ordem end), '[]'::jsonb)
                            from public.treinamento_alternativas a where a.pergunta_id = p.id))
         order by case when v_t.embaralhar then random() else p.ordem end)
  into v_perguntas from public.treinamento_perguntas p where p.treinamento_id = v_t.id;

  insert into public.treinamento_tentativas (treinamento_id, user_id, empresa_id, ciclo, numero, perguntas)
  values (v_t.id, v_uid, v_t.empresa_id, v_m.ciclo, v_usadas + 1, v_perguntas) returning * into v_x;
  return to_jsonb(v_x) - 'correcao' - 'pontos_auto';
end;
$$;

-- Fecha a tentativa: aprova, reprova (e, sem tentativas, volta o conteúdo) e avisa a pessoa
create or replace function app.fechar_tentativa(p_tentativa uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_x public.treinamento_tentativas; v_t public.treinamentos; v_aprovou boolean;
begin
  select * into v_x from public.treinamento_tentativas where id = p_tentativa;
  select * into v_t from public.treinamentos where id = v_x.treinamento_id;
  v_aprovou := v_x.nota >= v_t.nota_minima;
  update public.treinamento_tentativas set status = case when v_aprovou then 'aprovada' else 'reprovada' end where id = v_x.id;
  if v_aprovou then
    update public.treinamento_matriculas set aprovado_em = now(), nota = v_x.nota,
      valido_ate = case when v_t.validade_meses is not null then now() + make_interval(months => v_t.validade_meses) end
    where treinamento_id = v_t.id and user_id = v_x.user_id;
  elsif v_x.numero >= v_t.tentativas then
    update public.treinamento_matriculas set ciclo = ciclo + 1, conteudo_concluido_em = null
    where treinamento_id = v_t.id and user_id = v_x.user_id and ciclo = v_x.ciclo;
  end if;
  perform app.notificar(v_t.empresa_id, v_x.user_id, 'treinamento',
    case when v_aprovou then 'Aprovado em ' || v_t.titulo else 'Não aprovado em ' || v_t.titulo end,
    'Nota ' || to_char(v_x.nota, 'FM990D0') || ' (mínimo ' || v_t.nota_minima || ').'
      || case when not v_aprovou and v_x.numero >= v_t.tentativas then ' As tentativas acabaram: refaça o conteúdo para tentar de novo.' else '' end);
end;
$$;

-- p_respostas: { "<pergunta>": ["<alternativa>", ...] } ou { "<pergunta>": "texto" } para a escrita
create or replace function public.enviar_prova(p_tentativa uuid, p_respostas jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_x public.treinamento_tentativas; v_total numeric := 0; v_pontos numeric := 0;
  v_escrita boolean := false; p record; v_marcadas text[]; v_certas text[];
begin
  select * into v_x from public.treinamento_tentativas where id = p_tentativa and user_id = v_uid for update;
  if not found then raise exception 'prova_nao_encontrada' using errcode = 'P0002'; end if;
  if v_x.status <> 'em_andamento' then raise exception 'prova_ja_enviada' using errcode = 'P0001'; end if;
  for p in select q.* from public.treinamento_perguntas q where q.treinamento_id = v_x.treinamento_id loop
    v_total := v_total + p.peso;
    if p.tipo = 'escrita' then
      v_escrita := true;
    else
      select coalesce(array_agg(x order by x), '{}') into v_marcadas
      from jsonb_array_elements_text(case when jsonb_typeof(p_respostas -> p.id::text) = 'array' then p_respostas -> p.id::text else '[]'::jsonb end) x;
      select coalesce(array_agg(a.id::text order by a.id::text), '{}') into v_certas
      from public.treinamento_alternativas a where a.pergunta_id = p.id and a.correta;
      if v_marcadas = v_certas then v_pontos := v_pontos + p.peso; end if;   -- várias certas: só vale se acertar todas
    end if;
  end loop;
  update public.treinamento_tentativas set respostas = coalesce(p_respostas, '{}'::jsonb), enviada_em = now(),
    pontos_auto = v_pontos, nota = case when v_escrita then null else round(100 * v_pontos / nullif(v_total, 0), 2) end,
    status = case when v_escrita then 'aguardando_correcao' else status end
  where id = v_x.id;
  if v_escrita then
    perform app.notificar(v_x.empresa_id, m.user_id, 'treinamento', 'Prova para corrigir',
      'Há respostas escritas aguardando correção em ' || (select titulo from public.treinamentos where id = v_x.treinamento_id) || '.')
    from (select distinct user_id from public.membros where empresa_id = v_x.empresa_id and ativo and perfil in ('admin', 'gestor_frota')) m;
  else
    perform app.fechar_tentativa(v_x.id);
  end if;
  select * into v_x from public.treinamento_tentativas where id = v_x.id;
  return jsonb_build_object('status', v_x.status, 'nota', v_x.nota,
    'acertos', v_pontos, 'total', v_total,
    'nota_minima', (select nota_minima from public.treinamentos where id = v_x.treinamento_id));
end;
$$;

-- Gestor corrige as respostas escritas: p_pontos = { "<pergunta>": 0 a 1 } (fração do peso)
create or replace function public.corrigir_prova(p_tentativa uuid, p_pontos jsonb, p_comentario text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_x public.treinamento_tentativas; v_total numeric; v_escritas numeric := 0; p record; v_f numeric;
begin
  select * into v_x from public.treinamento_tentativas where id = p_tentativa for update;
  if not found or not app.pode_gerir_treinamento(v_x.empresa_id) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if v_x.status <> 'aguardando_correcao' then raise exception 'prova_ja_corrigida' using errcode = 'P0001'; end if;
  select sum(peso) into v_total from public.treinamento_perguntas where treinamento_id = v_x.treinamento_id;
  for p in select * from public.treinamento_perguntas where treinamento_id = v_x.treinamento_id and tipo = 'escrita' loop
    v_f := (p_pontos ->> p.id::text)::numeric;
    if v_f is null or v_f < 0 or v_f > 1 then raise exception 'correcao_incompleta' using errcode = 'P0001'; end if;
    v_escritas := v_escritas + v_f * p.peso;
  end loop;
  update public.treinamento_tentativas set correcao = p_pontos, comentario = nullif(trim(p_comentario), ''),
    corrigida_por = (select auth.uid()), corrigida_em = now(),
    nota = round(100 * (v_x.pontos_auto + v_escritas) / nullif(v_total, 0), 2)
  where id = v_x.id;
  perform app.fechar_tentativa(v_x.id);
end;
$$;

-- ---------------------------------------------------------------- acesso
alter table public.treinamentos enable row level security;
alter table public.treinamento_etapas enable row level security;
alter table public.treinamento_perguntas enable row level security;
alter table public.treinamento_alternativas enable row level security;
alter table public.treinamento_matriculas enable row level security;
alter table public.treinamento_progresso enable row level security;
alter table public.treinamento_tentativas enable row level security;
revoke all on public.treinamentos, public.treinamento_etapas, public.treinamento_perguntas, public.treinamento_alternativas,
  public.treinamento_matriculas, public.treinamento_progresso, public.treinamento_tentativas from anon, authenticated;
grant select, insert, update, delete on public.treinamentos, public.treinamento_etapas, public.treinamento_perguntas,
  public.treinamento_alternativas to authenticated;
grant select on public.treinamento_matriculas, public.treinamento_progresso, public.treinamento_tentativas to authenticated;

-- Gestão: só admin e gestor de frota. O colaborador usa as funções (nunca lê o gabarito).
create policy treinamentos_gestao on public.treinamentos for all to authenticated
  using (app.pode_gerir_treinamento(empresa_id))
  with check (app.pode_gerir_treinamento(empresa_id) and (publicado_em is null or app.pode_gerir_treinamento(empresa_id)));
create policy etapas_gestao on public.treinamento_etapas for all to authenticated
  using (app.pode_gerir_treinamento(empresa_id)) with check (app.pode_gerir_treinamento(empresa_id));
create policy perguntas_gestao on public.treinamento_perguntas for all to authenticated
  using (app.pode_gerir_treinamento(empresa_id)) with check (app.pode_gerir_treinamento(empresa_id));
create policy alternativas_gestao on public.treinamento_alternativas for all to authenticated
  using (app.pode_gerir_treinamento(empresa_id)) with check (app.pode_gerir_treinamento(empresa_id));
create policy matriculas_select on public.treinamento_matriculas for select to authenticated
  using (user_id = (select auth.uid()) or app.pode_gerir_treinamento(empresa_id));
create policy progresso_select on public.treinamento_progresso for select to authenticated
  using (user_id = (select auth.uid()) or app.pode_gerir_treinamento(empresa_id));
create policy tentativas_select on public.treinamento_tentativas for select to authenticated
  using (user_id = (select auth.uid()) or app.pode_gerir_treinamento(empresa_id));

-- Publicar só pela função (que confere a prova); a inserção começa sempre como rascunho
create or replace function app.treinamento_nasce_rascunho()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (new.publicado_em is not null) then new.publicado_em := null; end if;
  new.familia_id := coalesce(new.familia_id, new.id);
  return new;
end;
$$;
create trigger treinamentos_rascunho before insert on public.treinamentos
  for each row execute function app.treinamento_nasce_rascunho();

-- Treinamento publicado não se apaga (guarda o histórico de quem fez); só se desativa
create or replace function app.treinamento_publicado_nao_apaga()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.publicado_em is not null then raise exception 'treinamento_publicado_nao_muda' using errcode = 'P0001'; end if;
  return old;
end;
$$;
create trigger treinamentos_nao_apaga before delete on public.treinamentos
  for each row execute function app.treinamento_publicado_nao_apaga();

create trigger auditar_treinamentos after insert or update or delete on public.treinamentos
  for each row execute function app.auditar();

revoke all on function app.treinamento_em_rascunho(uuid), app.publico_inclui(uuid, public.perfil_membro[], uuid[], uuid, uuid),
  app.pode_fazer_treinamento(public.treinamentos, uuid), app.matricula(uuid, uuid), app.fechar_tentativa(uuid),
  app.treinamento_publicado_bloqueia(), app.treinamento_publicado_nao_apaga(), app.treinamento_nasce_rascunho(), app.treinamento_imutavel() from public, anon, authenticated;
revoke all on function app.pode_gerir_treinamento(uuid) from public, anon;
grant execute on function app.pode_gerir_treinamento(uuid) to authenticated;
revoke all on function public.publicar_treinamento(uuid), public.nova_versao_treinamento(uuid), public.meus_treinamentos(uuid),
  public.conteudo_treinamento(uuid), public.sinal_etapa(uuid, uuid, numeric, boolean, boolean), public.confirmar_presenca(uuid),
  public.iniciar_prova(uuid), public.enviar_prova(uuid, jsonb), public.corrigir_prova(uuid, jsonb, text) from public, anon;
grant execute on function public.publicar_treinamento(uuid), public.nova_versao_treinamento(uuid), public.meus_treinamentos(uuid),
  public.conteudo_treinamento(uuid), public.sinal_etapa(uuid, uuid, numeric, boolean, boolean), public.confirmar_presenca(uuid),
  public.iniciar_prova(uuid), public.enviar_prova(uuid, jsonb), public.corrigir_prova(uuid, jsonb, text) to authenticated;

-- Arquivos (vídeos curtos e PDFs): bucket privado, 50 MB; caminho = <empresa>/<treinamento>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('treinamentos', 'treinamentos', false, 52428800, array['video/mp4', 'video/webm', 'application/pdf'])
on conflict (id) do nothing;
create policy treinamentos_arquivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'treinamentos'
    and exists (select 1 from public.membros m where m.user_id = (select auth.uid()) and m.ativo
                and m.empresa_id::text = (storage.foldername(name))[1] and m.perfil in ('admin', 'gestor_frota')));
create policy treinamentos_arquivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'treinamentos'
    and exists (select 1 from public.membros m where m.user_id = (select auth.uid()) and m.ativo
                and m.empresa_id::text = (storage.foldername(name))[1] and m.perfil in ('admin', 'gestor_frota')));
create policy treinamentos_arquivos_select on storage.objects for select to authenticated
  using (bucket_id = 'treinamentos'
    and (storage.foldername(name))[1] in (select e::text from app.empresas_do_usuario() e));

-- Exportação LGPD inclui os treinamentos
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
                    where l.user_id = eu.uid and l.empresa_id = p_empresa),
    'treinamentos', (select jsonb_agg(jsonb_build_object('treinamento', t.titulo, 'versao', t.versao, 'iniciado_em', m.iniciado_em,
                       'aprovado_em', m.aprovado_em, 'nota', m.nota, 'valido_ate', m.valido_ate,
                       'tempo_por_etapa', (select jsonb_agg(jsonb_build_object('etapa', e.titulo, 'segundos', round(pr.segundos), 'concluida_em', pr.concluida_em, 'ciclo', pr.ciclo))
                                           from public.treinamento_progresso pr join public.treinamento_etapas e on e.id = pr.etapa_id
                                           where pr.user_id = eu.uid and pr.treinamento_id = t.id),
                       'provas', (select jsonb_agg(jsonb_build_object('numero', x.numero, 'nota', x.nota, 'status', x.status, 'enviada_em', x.enviada_em, 'respostas', x.respostas))
                                  from public.treinamento_tentativas x where x.user_id = eu.uid and x.treinamento_id = t.id)))
                     from public.treinamento_matriculas m join public.treinamentos t on t.id = m.treinamento_id, eu
                     where m.user_id = eu.uid and m.empresa_id = p_empresa)
  )
  from eu
$$;
