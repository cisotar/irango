-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 320 — Migração de DADOS da frequência de exibição (RN-4).
-- Spec: specs/frequencia-exibicao.md (RN-4). Plano: plan/tecnico-frequencia-exibicao.md (C1, D9).
--
-- Todo produto `visibilidade = 'cardapio'` volta a `'menu'` (permanente). Nada
-- é convertido para frequência: as 5 colunas novas continuam NULL.
-- `cardapios` e `cardapio_produtos` ficam intactos (cardápio vira função
-- morta, S5).
--
-- Arquivo isolado (D9) para ser testável de verdade: o teste semeia um produto
-- 'cardapio' e reexecuta este SQL. IDEMPOTENTE: a segunda execução casa zero
-- linhas.
--
-- O trigger RN-14 (20260920131000_produtos_exclusivo_trigger.sql) só dispara
-- `when (new.visibilidade = 'cardapio')`: a volta ao menu não passa por ele.
--
-- Dado de produção afetado: os produtos 'cardapio' da Alma Bragantina.
--
-- ROLLBACK (manual): ids guardados localmente no P0
--   (plan/rollback-frequencia-exibicao.local.md, não versionado) →
--   update public.produtos set visibilidade = 'cardapio' where id in (...);
--   Os vínculos seguem intactos, então o trigger RN-14 aceita.
-- ─────────────────────────────────────────────────────────────────────────────

update public.produtos
   set visibilidade = 'menu'
 where visibilidade = 'cardapio';
