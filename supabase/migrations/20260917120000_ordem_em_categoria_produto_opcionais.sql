-- Issue 208 — `ordem` do grupo de opcional DENTRO da categoria de produto.
-- Spec: specs/opcionais-sanfona-e-ordenacao.md (v0.2.0), Migration 1.
-- Plano: plan/208-migration-ordem-na-associacao.md §2.
--
-- expand + backfill numa migration só (sem contract: nada é removido). As duas
-- instruções rodam na MESMA transação, sob o ACCESS EXCLUSIVE que o ADD COLUMN
-- já segura — não existe janela em que uma linha nova escape do backfill.
--
-- Rollback:
--   alter table public.categoria_produto_opcionais drop column if exists ordem;
-- (leva junto o índice (loja_id, categoria_id, ordem), que a contém). Sem perda:
-- `opcionais_categorias.ordem` continua intacta e o backfill é reproduzível a
-- partir dela. Rollback COMPLETO: dropar antes a função da migration seguinte.
--
-- O índice EXISTENTE (loja_id, categoria_id) — 20260614007500_opcionais.sql:69 —
-- NÃO é dropado de propósito: o `drop column` do rollback derrubaria o índice
-- novo junto e a vitrine (produtos.ts:225 e :300) ficaria sem índice nenhum.
--
-- RLS: NENHUMA policy nova. `cat_prod_opc_escrita_propria` é `for all` e
-- `cat_prod_opc_leitura_publica` é `for select` (20260614007500_opcionais.sql:144
-- e :152) — policy é por LINHA, não por coluna, então a coluna nova já nasce
-- coberta. Grants também são de TABELA, não de coluna: nada é reemitido.

-- (1) expand — default não-volátil → metadata-only no PG 11+, sem rewrite.
alter table public.categoria_produto_opcionais
  add column if not exists ordem int not null default 0;

comment on column public.categoria_produto_opcionais.ordem is
  'Posicao do grupo de opcional DENTRO desta categoria de produto (0-based). Autoridade da ordem na vitrine (RN-2/RN-10). Escrita so por public.reordenar_opcionais_da_categoria.';

-- (2) backfill NEUTRO (RN-13): reproduz exatamente a ordem que a vitrine exibe
--     hoje — `opcionais_categorias.ordem`, desempate por `nome` — particionada
--     por (loja_id, categoria_id). O terceiro critério (`categoria_opcional_id`)
--     é desempate TOTAL: não há unique (loja_id, nome) em opcionais_categorias,
--     e sem ele o row_number() seria não-determinístico.
--     Idempotente: `is distinct from` torna o replay um no-op.
update public.categoria_produto_opcionais cpo
   set ordem = p.pos
  from (
    select cpo2.id,
           row_number() over (
             partition by cpo2.loja_id, cpo2.categoria_id
             order by oc.ordem, oc.nome, cpo2.categoria_opcional_id
           ) - 1 as pos
      from public.categoria_produto_opcionais cpo2
      join public.opcionais_categorias oc
        on oc.id = cpo2.categoria_opcional_id
       and oc.loja_id = cpo2.loja_id
  ) p
 where p.id = cpo.id
   and cpo.ordem is distinct from p.pos;

-- (3) índice que sustenta a leitura ordenada da vitrine (RN-2).
create index if not exists categoria_produto_opcionais_loja_categoria_ordem_idx
  on public.categoria_produto_opcionais (loja_id, categoria_id, ordem);
