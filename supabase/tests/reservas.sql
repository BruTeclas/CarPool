-- Testes das regras de reserva. Tudo roda numa transação que termina em exceção
-- 'OK_TESTES_PASSARAM' (desfaz os dados). Qualquer outra mensagem é falha.
do $$
declare
  tz constant text := 'America/Sao_Paulo';
  ea constant uuid := '11111111-1111-1111-1111-111111111111';
  u_mot uuid; u_gestor uuid; u_mot_b uuid;
  car1 uuid; car2 uuid;
  seg timestamptz := (date_trunc('week', now() at time zone tz) + interval '14 days' + interval '1 day' + time '10:00') at time zone tz; -- terça, 2 semanas à frente
  r public.reservas; n int; msg text;
begin
  select id into u_mot from auth.users where email = 'motorista.a@carpool.test';
  select id into u_gestor from auth.users where email = 'gestor.a@carpool.test';
  select id into u_mot_b from auth.users where email = 'motorista.b@carpool.test';
  select id into car1 from public.veiculos where placa = 'ABC1D23';
  select id into car2 from public.veiculos where placa = 'EFG4H56';

  perform set_config('request.jwt.claims', json_build_object('sub', u_mot, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Reserva simples fica aprovada e gera evento
  r := public.criar_reserva(car1, seg, seg + interval '2 hours', 'visita', 'Campinas', 1);
  if r.status <> 'aprovada' then raise exception 'FALHOU 1: status %', r.status; end if;
  select count(*) into n from public.eventos_da_reserva where reserva_id = r.id;
  if n <> 1 then raise exception 'FALHOU 1: eventos=%', n; end if;

  -- 2. Conflito de agenda
  begin perform public.criar_reserva(car1, seg + interval '1 hour', seg + interval '3 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'conflito_agenda' then raise exception 'FALHOU 2: %', msg; end if;

  -- 3. Intervalo técnico: 10 min depois do fim conflita; 30 min depois libera
  begin perform public.criar_reserva(car1, seg + interval '2 hours 10 minutes', seg + interval '4 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'conflito_agenda' then raise exception 'FALHOU 3a: %', msg; end if;
  perform public.criar_reserva(car1, seg + interval '2 hours 30 minutes', seg + interval '4 hours');

  -- 4. Disponibilidade
  select count(*) into n from public.disponibilidade(seg, seg + interval '1 hour') where veiculo_id = car1;
  if n <> 0 then raise exception 'FALHOU 4: carro reservado aparece como livre'; end if;
  select count(*) into n from public.disponibilidade(seg, seg + interval '1 hour') where veiculo_id = car2;
  if n <> 1 then raise exception 'FALHOU 4: carro livre não aparece'; end if;

  -- 5. Antecedência mínima e duração máxima
  begin perform public.criar_reserva(car2, now() + interval '10 minutes', now() + interval '2 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'antecedencia_minima_nao_respeitada' then raise exception 'FALHOU 5a: %', msg; end if;
  begin perform public.criar_reserva(car2, seg, seg + interval '13 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'duracao_maxima_excedida' then raise exception 'FALHOU 5b: %', msg; end if;

  -- 6. Escrita direta nas tabelas é negada
  begin update public.reservas set status = 'encerrada'; msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 6: update direto em reservas funcionou'; end if;
  begin insert into public.eventos_da_reserva (empresa_id, reserva_id, para_status) values (ea, r.id, 'aprovada'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 6: insert direto em eventos funcionou'; end if;

  -- 7. Transição inválida (aprovada -> em_uso sem liberar)
  begin perform public.transicionar_reserva(r.id, 'em_uso'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null or msg not like 'transicao_nao_permitida%' then raise exception 'FALHOU 7: %', msg; end if;

  -- 8. Pernoite exige aprovação; motorista não aprova a própria
  r := public.criar_reserva(car2, seg + interval '10 hours', seg + interval '22 hours');
  if r.status <> 'solicitada' then raise exception 'FALHOU 8: pernoite deveria exigir aprovação, veio %', r.status; end if;
  begin perform public.transicionar_reserva(r.id, 'aprovada'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null or msg not like 'transicao_nao_permitida%' then raise exception 'FALHOU 8b: motorista aprovou a própria reserva (%)', msg; end if;
  reset role;

  -- 9. Gestor de frota aprova; fica registrado
  perform set_config('request.jwt.claims', json_build_object('sub', u_gestor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.transicionar_reserva(r.id, 'aprovada', '{"justificativa":"ok"}');
  if r.status <> 'aprovada' then raise exception 'FALHOU 9'; end if;
  select count(*) into n from public.aprovacoes where reserva_id = r.id and decisao = 'aprovada';
  if n <> 1 then raise exception 'FALHOU 9: aprovação não registrada'; end if;
  reset role;

  -- 10. Evento é imutável (nem o dono da tabela altera)
  begin update public.eventos_da_reserva set detalhe = '{}'; msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FALHOU 10: evento foi alterado'; end if;

  -- 11. Outra empresa não vê nem reserva carro de A
  perform set_config('request.jwt.claims', json_build_object('sub', u_mot_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.reservas;
  if n <> 0 then raise exception 'FALHOU 11: motorista B vê % reservas de A', n; end if;
  begin perform public.criar_reserva(car1, seg + interval '6 hours', seg + interval '7 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'veiculo_nao_encontrado' then raise exception 'FALHOU 11b: %', msg; end if;
  reset role;

  -- 12. CNH vencida bloqueia
  update public.cnhs set validade = current_date - 1 where user_id = u_mot;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.criar_reserva(car2, seg + interval '6 hours', seg + interval '7 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'cnh_vencida' then raise exception 'FALHOU 12: %', msg; end if;
  reset role;
  update public.cnhs set validade = date '2030-12-31' where user_id = u_mot;

  -- 13. Política vigente precisa ser aceita
  insert into public.politicas (empresa_id, nome) values (ea, 'Uso de frota');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mot, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.criar_reserva(car2, seg + interval '6 hours', seg + interval '7 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'politica_nao_aceita' then raise exception 'FALHOU 13: %', msg; end if;
  insert into public.aceites_de_politica (empresa_id, politica_id, user_id)
    select ea, id, u_mot from public.politicas where empresa_id = ea;
  perform public.criar_reserva(car2, seg + interval '6 hours', seg + interval '7 hours');

  -- 14. Cancelar libera o horário
  r := public.criar_reserva(car1, seg + interval '8 hours', seg + interval '9 hours');
  begin perform public.criar_reserva(car1, seg + interval '8 hours', seg + interval '9 hours'); msg := null;
  exception when others then msg := sqlerrm; end;
  if msg is distinct from 'conflito_agenda' then raise exception 'FALHOU 14a: %', msg; end if;
  perform public.transicionar_reserva(r.id, 'cancelada');
  perform public.criar_reserva(car1, seg + interval '8 hours', seg + interval '9 hours');
  reset role;

  raise exception 'OK_TESTES_PASSARAM';
end $$;
