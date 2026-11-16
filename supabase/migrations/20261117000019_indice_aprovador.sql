-- Revisão de segurança e desempenho (Sprint 7): índice da chave estrangeira apontada pelo advisor.
-- As demais recomendações foram avaliadas e mantidas de propósito (ver supabase/README.md, "Revisão de segurança").
create index if not exists aprovacoes_aprovador_id_idx on public.aprovacoes (aprovador_id);
