-- Sprint 7 · corrige a rotina de retenção: o apelido da tabela empresas colidia com a variável do laço
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
  delete from public.registro_de_auditoria a using public.empresas emp
  where a.empresa_id = emp.id and a.em < now() - make_interval(days => emp.retencao_auditoria_dias);
  set local session_replication_role = origin;
  return v;
end;
$$;

