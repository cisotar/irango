-- RN-01 (v1): uma loja por dono. Defesa em profundidade — a checagem
-- autoritativa é contarLojasDoDono na Server Action (015); o índice barra
-- corridas de duplo-submit que passem pelas duas contagens antes do INSERT.
-- Fase 2 (N lojas por dono) remove este índice por migration. (architecture.md §10)
create unique index lojas_dono_unico on public.lojas(dono_id);
