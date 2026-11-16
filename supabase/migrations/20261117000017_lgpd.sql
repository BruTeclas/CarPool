-- Sprint 7 · LGPD: aviso de privacidade com ciência, direitos do titular (exportar, corrigir, pedir exclusão),
-- anonimização de ex-colaboradores e prazos de retenção aplicados por rotina diária.
-- Arquivos vencidos vão para uma fila; a função `limpar-arquivos` apaga do Storage (o SQL não pode apagar lá).

create extension if not exists pg_net;

-- ---------------------------------------------------------------- prazos por empresa
alter table public.empresas
  add column retencao_localizacao_dias int not null default 180 check (retencao_localizacao_dias between 30 and 3650),
  add column retencao_fotos_dias int not null default 730 check (retencao_fotos_dias between 90 and 3650),
  add column retencao_documentos_dias int not null default 365 check (retencao_documentos_dias between 30 and 3650),
  add column retencao_inativos_dias int not null default 365 check (retencao_inativos_dias between 30 and 3650),
  add column retencao_avisos_dias int not null default 90 check (retencao_avisos_dias between 7 and 3650),
  add column retencao_auditoria_dias int not null default 1825 check (retencao_auditoria_dias between 365 and 3650),
  add column encarregado_contato text;

-- Quando a pessoa deixou de ser membro (conta o prazo de anonimização)
alter table public.membros add column inativado_em timestamptz;
update public.membros set inativado_em = now() where not ativo and inativado_em is null;
create or replace function app.marcar_inativacao()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.ativo is false and old.ativo is true then new.inativado_em := now();
  elsif new.ativo is true then new.inativado_em := null; end if;
  return new;
end;
$$;
revoke all on function app.marcar_inativacao() from public, anon, authenticated;
create trigger membros_marcar_inativacao before update of ativo on public.membros
  for each row execute function app.marcar_inativacao();

-- ---------------------------------------------------------------- aviso de privacidade
create table public.avisos_privacidade (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  versao int not null check (versao > 0),
  texto text not null check (length(trim(texto)) > 0),
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (empresa_id, versao)
);
create index on public.avisos_privacidade (empresa_id) where ativo;
create index on public.avisos_privacidade (criado_por);

create table public.ciencias_privacidade (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  aviso_id uuid not null references public.avisos_privacidade(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  em timestamptz not null default now(),
  unique (aviso_id, user_id)
);
create index on public.ciencias_privacidade (user_id);
create index on public.ciencias_privacidade (empresa_id);

alter table public.avisos_privacidade enable row level security;
alter table public.ciencias_privacidade enable row level security;
revoke all on public.avisos_privacidade, public.ciencias_privacidade from anon, authenticated;
grant select on public.avisos_privacidade, public.ciencias_privacidade to authenticated;
grant insert, update on public.avisos_privacidade to authenticated;

create policy avisos_select on public.avisos_privacidade for select to authenticated
  using (empresa_id in (select app.empresas_do_usuario()));
create policy avisos_insert on public.avisos_privacidade for insert to authenticated
  with check (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));
create policy avisos_update on public.avisos_privacidade for update to authenticated
  using (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]))
  with check (app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));
create policy ciencias_select on public.ciencias_privacidade for select to authenticated
  using (user_id = (select auth.uid()) or app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));

-- O texto publicado não muda (só ativar/desativar); a ciência não muda nem some
create or replace function app.aviso_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.texto is distinct from old.texto or new.versao is distinct from old.versao or new.empresa_id is distinct from old.empresa_id then
    raise exception 'aviso_publicado_nao_muda' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function app.aviso_imutavel() from public, anon, authenticated;
create trigger avisos_imutavel before update on public.avisos_privacidade for each row execute function app.aviso_imutavel();
create trigger ciencias_sem_update before update on public.ciencias_privacidade for each row execute function app.bloquear_alteracao();
create trigger auditar_avisos after insert or update or delete on public.avisos_privacidade for each row execute function app.auditar();

create or replace function public.aviso_privacidade_pendente(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(a) - 'criado_por'
  from public.avisos_privacidade a
  where a.empresa_id = p_empresa and a.ativo and p_empresa in (select app.empresas_do_usuario())
    and not exists (select 1 from public.ciencias_privacidade c where c.aviso_id = a.id and c.user_id = (select auth.uid()))
  order by a.versao desc limit 1
$$;

create or replace function public.dar_ciencia_privacidade(p_aviso uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_a public.avisos_privacidade;
begin
  select * into v_a from public.avisos_privacidade where id = p_aviso and ativo;
  if not found or v_a.empresa_id not in (select app.empresas_do_usuario()) then
    raise exception 'aviso_nao_encontrado' using errcode = 'P0002';
  end if;
  insert into public.ciencias_privacidade (empresa_id, aviso_id, user_id) values (v_a.empresa_id, v_a.id, (select auth.uid()))
  on conflict (aviso_id, user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------- pedidos do titular
create table public.solicitacoes_titular (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('correcao', 'eliminacao', 'outro')),
  descricao text not null check (length(trim(descricao)) > 0),
  status text not null default 'aberta' check (status in ('aberta', 'atendida', 'recusada')),
  resposta text,
  respondida_por uuid references auth.users(id) on delete set null,
  respondida_em timestamptz,
  criado_em timestamptz not null default now()
);
create index on public.solicitacoes_titular (empresa_id, status);
create index on public.solicitacoes_titular (user_id);
create index on public.solicitacoes_titular (respondida_por);
alter table public.solicitacoes_titular enable row level security;
revoke all on public.solicitacoes_titular from anon, authenticated;
grant select on public.solicitacoes_titular to authenticated;
create policy solicitacoes_select on public.solicitacoes_titular for select to authenticated
  using (user_id = (select auth.uid()) or app.tem_perfil(empresa_id, array['admin']::public.perfil_membro[]));
create trigger auditar_solicitacoes after insert or update or delete on public.solicitacoes_titular for each row execute function app.auditar();

create or replace function public.pedir_ao_controlador(p_empresa uuid, p_tipo text, p_descricao text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_empresa not in (select app.empresas_do_usuario()) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  insert into public.solicitacoes_titular (empresa_id, user_id, tipo, descricao)
  values (p_empresa, (select auth.uid()), p_tipo, trim(p_descricao)) returning id into v_id;
  insert into public.notificacoes (empresa_id, user_id, tipo, titulo, corpo, link)
  select p_empresa, m.user_id, 'privacidade', 'Novo pedido sobre dados pessoais',
         'Uma pessoa fez um pedido de ' || case p_tipo when 'correcao' then 'correção' when 'eliminacao' then 'exclusão' else 'informação' end
         || ' de dados. Responda em Privacidade (prazo legal de 15 dias).', '/privacidade'
  from public.membros m where m.empresa_id = p_empresa and m.ativo and m.perfil = 'admin';
  return v_id;
end;
$$;

create or replace function public.atualizar_meu_nome(p_empresa uuid, p_nome text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(length(trim(p_nome)), 0) < 3 then raise exception 'nome_obrigatorio' using errcode = 'P0001'; end if;
  update public.membros set nome = trim(p_nome) where empresa_id = p_empresa and user_id = (select auth.uid());
  if not found then raise exception 'sem_permissao' using errcode = '42501'; end if;
end;
$$;

-- Tudo o que o sistema guarda sobre a pessoa nesta empresa (portabilidade e acesso, art. 18 da LGPD)
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
                            from public.solicitacoes_titular s, eu where s.user_id = eu.uid and s.empresa_id = p_empresa)
  )
  from eu
$$;

-- ---------------------------------------------------------------- fila de arquivos a apagar do Storage
create table public.arquivos_a_apagar (
  id bigint generated always as identity primary key,
  bucket text not null,
  caminho text not null,
  motivo text not null,
  em timestamptz not null default now(),
  unique (bucket, caminho)
);
alter table public.arquivos_a_apagar enable row level security;
revoke all on public.arquivos_a_apagar from anon, authenticated;

create or replace function app.enfileirar_arquivo(p_bucket text, p_caminho text, p_motivo text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.arquivos_a_apagar (bucket, caminho, motivo) values (p_bucket, p_caminho, p_motivo)
  on conflict (bucket, caminho) do nothing
$$;

-- Senha da limpeza: gerada e guardada no cofre do próprio banco; nunca aparece em código
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'carpool_limpeza_token', 'Senha da rotina de limpeza de arquivos (LGPD)')
where not exists (select 1 from vault.secrets where name = 'carpool_limpeza_token');

-- Usadas só pela função limpar-arquivos (service_role)
create or replace function public.conferir_token_limpeza(p_token text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from vault.decrypted_secrets where name = 'carpool_limpeza_token' and decrypted_secret = p_token) $$;
create or replace function public.arquivos_para_apagar(p_limite int default 500)
returns setof public.arquivos_a_apagar language sql stable security definer set search_path = ''
as $$ select * from public.arquivos_a_apagar order by id limit least(p_limite, 1000) $$;
create or replace function public.confirmar_arquivos_apagados(p_ids bigint[])
returns int language sql security definer set search_path = ''
as $$ with x as (delete from public.arquivos_a_apagar where id = any (p_ids) returning 1) select count(*)::int from x $$;

-- ---------------------------------------------------------------- anonimização
-- Mantém o histórico operacional (reservas, vistorias, eventos) sem identificar a pessoa.
-- Termos assinados ficam guardados como prova (obrigação legal e defesa em processo), dentro do prazo de auditoria.
create or replace function app.anonimizar(p_empresa uuid, p_user uuid, p_motivo text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if exists (select 1 from public.reservas x where x.empresa_id = p_empresa and p_user in (x.motorista_id, x.solicitante_id)
             and x.status in ('solicitada','aprovada','liberada','em_uso','atrasada','ocorrencia','devolvida')) then
    raise exception 'pessoa_com_reserva_em_andamento' using errcode = 'P0001';
  end if;

  for r in select d.caminho from public.documentos d where d.empresa_id = p_empresa and d.user_id = p_user loop
    perform app.enfileirar_arquivo('documentos', r.caminho, 'anonimizacao');
  end loop;
  delete from public.documentos where empresa_id = p_empresa and user_id = p_user;
  delete from public.cnhs where empresa_id = p_empresa and user_id = p_user;
  delete from public.notificacoes where empresa_id = p_empresa and user_id = p_user;
  delete from public.grupo_membros where empresa_id = p_empresa and user_id = p_user;
  delete from public.membro_unidades where empresa_id = p_empresa and user_id = p_user;
  delete from public.demandas_nao_atendidas where empresa_id = p_empresa and user_id = p_user;
  update public.incidentes set latitude = null, longitude = null, endereco = null where empresa_id = p_empresa and user_id = p_user;
  update public.fotos f set latitude = null, longitude = null
  from public.vistorias v where v.id = f.vistoria_id and v.empresa_id = p_empresa and v.autor_id = p_user;
  update public.membros set nome = 'Pessoa removida', ativo = false where empresa_id = p_empresa and user_id = p_user;

  -- Sem vínculo ativo com nenhuma outra empresa: a conta de acesso também deixa de identificar a pessoa
  if not exists (select 1 from public.membros m where m.user_id = p_user and m.empresa_id <> p_empresa and m.nome <> 'Pessoa removida') then
    update auth.users set email = 'removido-' || id || '@anonimo.invalid', phone = null, encrypted_password = '',
           raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity'
    where id = p_user;
    delete from auth.identities where user_id = p_user;
    delete from auth.sessions where user_id = p_user;
  end if;

  insert into public.registro_de_auditoria (empresa_id, user_id, tabela, operacao, registro_id, depois)
  values (p_empresa, (select auth.uid()), 'membros', 'UPDATE', null, jsonb_build_object('anonimizacao', p_motivo, 'pessoa', p_user));
end;
$$;

create or replace function public.anonimizar_pessoa(p_empresa uuid, p_user uuid, p_motivo text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app.tem_perfil(p_empresa, array['admin']::public.perfil_membro[]) then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'nao_pode_anonimizar_a_si_mesmo' using errcode = 'P0001'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'justificativa_obrigatoria' using errcode = 'P0001'; end if;
  if app.tem_perfil(p_empresa, array['admin']::public.perfil_membro[]) and exists (
       select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = p_user and m.perfil = 'admin' and m.ativo)
     and (select count(distinct m.user_id) from public.membros m where m.empresa_id = p_empresa and m.perfil = 'admin' and m.ativo) <= 1 then
    raise exception 'ultimo_admin' using errcode = 'P0001';
  end if;
  perform app.anonimizar(p_empresa, p_user, trim(p_motivo));
end;
$$;

create or replace function public.responder_solicitacao(p_solicitacao uuid, p_status text, p_resposta text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_s public.solicitacoes_titular;
begin
  select * into v_s from public.solicitacoes_titular where id = p_solicitacao for update;
  if not found or not app.tem_perfil(v_s.empresa_id, array['admin']::public.perfil_membro[]) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_status not in ('atendida', 'recusada') or coalesce(trim(p_resposta), '') = '' then
    raise exception 'justificativa_obrigatoria' using errcode = 'P0001';
  end if;
  update public.solicitacoes_titular set status = p_status, resposta = trim(p_resposta),
    respondida_por = (select auth.uid()), respondida_em = now() where id = p_solicitacao;
  insert into public.notificacoes (empresa_id, user_id, tipo, titulo, corpo, link)
  values (v_s.empresa_id, v_s.user_id, 'privacidade', 'Resposta ao seu pedido sobre dados pessoais', trim(p_resposta), '/');
end;
$$;

-- ---------------------------------------------------------------- rotina diária de retenção
create or replace function app.rotina_lgpd()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  e record; r record;
  v jsonb := '{}'::jsonb; n int;
begin
  for e in select * from public.empresas loop
    -- localização das fotos e ocorrências
    update public.fotos f set latitude = null, longitude = null
    where f.empresa_id = e.id and f.latitude is not null and f.tirada_em < now() - make_interval(days => e.retencao_localizacao_dias);
    update public.incidentes i set latitude = null, longitude = null
    where i.empresa_id = e.id and i.status = 'encerrada' and i.latitude is not null
      and i.registrada_em < now() - make_interval(days => e.retencao_localizacao_dias);

    -- fotos de vistoria antigas (exceto com avaria ou ocorrência ainda aberta)
    n := 0;
    for r in
      select f.id, f.caminho from public.fotos f join public.vistorias vi on vi.id = f.vistoria_id
      where f.empresa_id = e.id and f.criado_em < now() - make_interval(days => e.retencao_fotos_dias)
        and not exists (select 1 from public.avarias a where a.vistoria_id = vi.id and a.status = 'aberta')
        and not exists (select 1 from public.incidentes i where i.reserva_id = vi.reserva_id and i.status = 'aberta')
    loop
      perform app.enfileirar_arquivo('vistorias', r.caminho, 'retencao');
      delete from public.fotos where id = r.id;
      n := n + 1;
    end loop;
    for r in select i.id, i.fotos from public.incidentes i
             where i.empresa_id = e.id and i.status = 'encerrada' and jsonb_array_length(i.fotos) > 0
               and i.registrada_em < now() - make_interval(days => e.retencao_fotos_dias)
    loop
      perform app.enfileirar_arquivo('vistorias', f ->> 'caminho', 'retencao') from jsonb_array_elements(r.fotos) f;
      update public.incidentes set fotos = '[]'::jsonb where id = r.id;
    end loop;

    -- documentos substituídos, vencidos ou recusados há mais que o prazo
    for r in
      select d.id, d.caminho from public.documentos d
      where d.empresa_id = e.id
        and d.id not in (select x.id from app.documentos_em_vigor x where x.empresa_id = e.id and (x.validade is null or x.validade >= current_date))
        and d.enviado_em < now() - make_interval(days => e.retencao_documentos_dias)
    loop
      perform app.enfileirar_arquivo('documentos', r.caminho, 'retencao');
      delete from public.documentos where id = r.id;
    end loop;

    -- avisos lidos
    delete from public.notificacoes where empresa_id = e.id and lida_em is not null
      and criada_em < now() - make_interval(days => e.retencao_avisos_dias);

    -- ex-colaboradores: anonimizados após o prazo sem vínculo ativo
    for r in
      select m.user_id from public.membros m
      where m.empresa_id = e.id and m.nome <> 'Pessoa removida'
      group by m.user_id
      having bool_and(not m.ativo) and max(m.inativado_em) < now() - make_interval(days => e.retencao_inativos_dias)
    loop
      begin
        perform app.anonimizar(e.id, r.user_id, 'prazo de retenção');
      exception when others then null; -- reserva ainda aberta: tenta de novo amanhã
      end;
    end loop;
    v := v || jsonb_build_object(e.id::text, jsonb_build_object('fotos_vencidas', n));
  end loop;

  -- trilha de auditoria além do maior prazo configurado (append-only: só esta rotina apaga)
  set local session_replication_role = replica;
  delete from public.registro_de_auditoria a using public.empresas e
  where a.empresa_id = e.id and a.em < now() - make_interval(days => e.retencao_auditoria_dias);
  set local session_replication_role = origin;
  return v;
end;
$$;

-- Chama a função que apaga os arquivos da fila no Storage
create or replace function app.chamar_limpeza_de_arquivos()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.arquivos_a_apagar) then return; end if;
  perform net.http_post(
    url := 'https://lsqssnerbocisxmhxfag.supabase.co/functions/v1/limpar-arquivos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-limpeza-token', (select decrypted_secret from vault.decrypted_secrets where name = 'carpool_limpeza_token')),
    body := '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- permissões
revoke all on function app.enfileirar_arquivo(text, text, text) from public, anon, authenticated;
revoke all on function app.anonimizar(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.rotina_lgpd() from public, anon, authenticated;
revoke all on function app.chamar_limpeza_de_arquivos() from public, anon, authenticated;
revoke all on function public.conferir_token_limpeza(text) from public, anon, authenticated;
revoke all on function public.arquivos_para_apagar(int) from public, anon, authenticated;
revoke all on function public.confirmar_arquivos_apagados(bigint[]) from public, anon, authenticated;
grant execute on function public.conferir_token_limpeza(text) to service_role;
grant execute on function public.arquivos_para_apagar(int) to service_role;
grant execute on function public.confirmar_arquivos_apagados(bigint[]) to service_role;

revoke all on function public.aviso_privacidade_pendente(uuid) from public, anon;
revoke all on function public.dar_ciencia_privacidade(uuid) from public, anon;
revoke all on function public.pedir_ao_controlador(uuid, text, text) from public, anon;
revoke all on function public.atualizar_meu_nome(uuid, text) from public, anon;
revoke all on function public.meus_dados(uuid) from public, anon;
revoke all on function public.anonimizar_pessoa(uuid, uuid, text) from public, anon;
revoke all on function public.responder_solicitacao(uuid, text, text) from public, anon;
grant execute on function public.aviso_privacidade_pendente(uuid) to authenticated;
grant execute on function public.dar_ciencia_privacidade(uuid) to authenticated;
grant execute on function public.pedir_ao_controlador(uuid, text, text) to authenticated;
grant execute on function public.atualizar_meu_nome(uuid, text) to authenticated;
grant execute on function public.meus_dados(uuid) to authenticated;
grant execute on function public.anonimizar_pessoa(uuid, uuid, text) to authenticated;
grant execute on function public.responder_solicitacao(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- agenda (03:23 e 03:53 em Brasília)
select cron.unschedule(jobid) from cron.job where jobname in ('carpool-lgpd', 'carpool-limpeza-arquivos');
select cron.schedule('carpool-lgpd', '23 6 * * *', 'select app.rotina_lgpd()');
select cron.schedule('carpool-limpeza-arquivos', '53 6 * * *', 'select app.chamar_limpeza_de_arquivos()');
