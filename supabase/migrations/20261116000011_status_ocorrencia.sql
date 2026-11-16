-- Sprint 5 · novo estado da reserva: pane, acidente, roubo ou furto durante o uso.
-- Fica numa migração separada porque um valor novo de enum só pode ser usado depois de gravado.
alter type public.status_reserva add value if not exists 'ocorrencia' after 'atrasada';
