-- Excluir um cadastro não pode apagar em silêncio o que depende dele.
-- Unidade com bases, base com vagas e grupo/base com políticas passam a ser barrados (erro 23503).
alter table public.bases drop constraint bases_unidade_id_fkey,
  add constraint bases_unidade_id_fkey foreign key (unidade_id) references public.unidades(id) on delete restrict;
alter table public.vagas drop constraint vagas_base_id_fkey,
  add constraint vagas_base_id_fkey foreign key (base_id) references public.bases(id) on delete restrict;
alter table public.politicas drop constraint politicas_grupo_id_fkey,
  add constraint politicas_grupo_id_fkey foreign key (grupo_id) references public.grupos(id) on delete restrict;
alter table public.politicas drop constraint politicas_base_id_fkey,
  add constraint politicas_base_id_fkey foreign key (base_id) references public.bases(id) on delete restrict;
