-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 219 — correção de achado do `auditar` (severidade MÉDIA).
--
-- `produtos_desconto_fixo_check`, como nasceu em 20260920120000, só tinha limite
-- SUPERIOR (`desconto_valor <= preco`). Logo `-50.00 <= 100.00` passava: desconto
-- fixo negativo grava `precoEfetivo = preco - desconto_valor = 150,00`, ou seja,
-- produto INFLACIONADO exibindo selo de promoção. `desconto_valor = 0` também
-- passava: selo de promoção sem desconto nenhum.
--
-- O percentual já era travado nos dois lados (`> 0 and <= 100`, RN-04). Esta
-- migration dá ao fixo a mesma simetria (RN-05).
--
-- Aditiva e sem risco de rewrite doloroso: nenhuma linha em produção tem
-- `desconto_tipo = 'fixo'` hoje (a coluna nasceu na migration anterior, e a
-- Server Action que grava desconto só chega na issue 230).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.produtos
  drop constraint if exists produtos_desconto_fixo_check;

alter table public.produtos
  add constraint produtos_desconto_fixo_check
  check (
    desconto_tipo is distinct from 'fixo'
    or (desconto_valor > 0 and desconto_valor <= preco)
  );

-- Rollback (sem perda de dado):
--   alter table public.produtos drop constraint if exists produtos_desconto_fixo_check;
--   alter table public.produtos
--     add constraint produtos_desconto_fixo_check
--     check (desconto_tipo is distinct from 'fixo' or desconto_valor <= preco);
