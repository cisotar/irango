-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 265 — migration A (EXPAND): `public.desconto_vigente()` +
-- `public.vitrine_produtos`, projeção pública do catálogo mascarada por vigência.
-- Spec: specs/desconto-por-produto-e-pratos-promocionais.md (RN-03, RN-07,
--       §Contrato de catálogo) · `seguranca.md` §19 (exceção de view definer).
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md §5.1.
-- Par: 20260920125000_produtos_drop_leitura_publica.sql (CONTRACT — só depois
--      do deploy do código que lê esta view; ver "Sequência" abaixo).
--
-- POR QUÊ: `produtos_leitura_publica` (20260621099000) libera a LINHA INTEIRA
-- de todo produto `oculto = false` de loja ativa, sem cláusula `TO` — vale para
-- `anon` E `authenticated`. Desde a 219 essa linha carrega o calendário
-- promocional (`desconto_ativo/tipo/valor/inicio/fim`): promoção desligada mas
-- configurada (RN-07 manda preservar), promoção agendada para o futuro e data
-- exata de término. RLS filtra LINHA, não COLUNA — o mesmo achado da issue 004
-- sobre `lojas`, resolvido pelo mesmo desenho: projeção pública por view
-- definer + remoção do SELECT público da base (migration B).
--
-- ESTA MIGRATION É ADITIVA: não toca policy, não toca a tabela, não muda o que
-- a vitrine lê hoje. Pode ir ao cloud antes do código. Só cria dois objetos:
--
-- 1) `public.desconto_vigente(ativo, inicio, fim, agora)` — a convenção
--    LITERAL de RN-03 em SQL: início INCLUSIVO, fim EXCLUSIVO (mesma convenção
--    de `lojaAberta`/`validarUsoCupom`). `agora` é PARÂMETRO (não `now()`
--    embutido) para que a função seja IMMUTABLE e testável com instantes
--    literais — é o contrato de igualdade com `precoEfetivo` (223): as mesmas
--    quatro bordas provadas dos dois lados. `ativo NULL ⇒ false`: a máscara
--    nunca fica indefinida.
--    A função NÃO calcula preço. Toda aritmética de dinheiro tem UMA fonte,
--    `precoEfetivo` em TS (D2). Aqui só se decide o que é VISÍVEL.
--
-- 2) `public.vitrine_produtos` — 14 colunas, ordem fixa (é a
--    `COLUNAS_PRODUTO_PUBLICO` do TS; teste [5a] trava a lista):
--      id, loja_id, categoria_id, nome, descricao, preco, disponivel, ordem,
--      foto_url, desconto_ativo, desconto_tipo, desconto_valor,
--      desconto_inicio, desconto_fim
--    AUSENTES por decisão (D6): `oculto` (seria sempre false — o filtro vive no
--    WHERE), `criado_em`, `atualizado_em`.
--    As cinco colunas de desconto saem MASCARADAS: `desconto_ativo` passa a
--    significar "vigente NESTE instante" (D5) e as outras quatro só saem quando
--    vigente — caso contrário NULL. A base PRESERVA a configuração (RN-07);
--    o painel do dono lê a tabela, não a view.
--    O WHERE é o predicado LITERAL da policy que a migration B derruba
--    (20260621099000): `oculto = false and public.loja_esta_ativa(loja_id)`.
--    Reusa `loja_esta_ativa` (security definer, 20260614002000) pelo mesmo
--    motivo de lá: a base `lojas` não tem SELECT público.
--
-- EXCEÇÃO DELIBERADA a seguranca.md §19 (segunda, após `vitrine_lojas`):
--   `security_invoker = false` por NECESSIDADE: sem SELECT público na base
--   (migration B), uma view invoker devolveria ZERO linhas — para `anon` e
--   para o lojista logado navegando outra vitrine (SSR roda como
--   `authenticated`). A definer serve os dois igualmente e expõe SÓ as colunas
--   projetadas. Não há tenant a violar: `loja_id` já vai na URL da vitrine e o
--   WHERE é exatamente o que a policy pública já liberava.
--
-- FORMA DA VIEW (FROM único, função chamada inline, sem `cross join lateral`):
--   o snippet da issue usava `lateral`, o que torna a view NÃO auto-atualizável
--   e faz o Postgres responder `55000 cannot update view` na REESCRITA — antes
--   de checar privilégio. O `revoke` viraria decoração. Com FROM único a view é
--   auto-atualizável em forma (como `vitrine_lojas`) e quem nega escrita é o
--   `revoke all` abaixo, com `42501` — a trava passa a ser a permissão, não um
--   acidente de sintaxe (teste [6a]). `desconto_vigente` é IMMUTABLE e barata;
--   chamá-la cinco vezes por linha custa o mesmo que a policy que substitui.
--
-- SELECT-only: `revoke all` + `grant select` (regra de §19, "toda view definer
-- pública"). A 20260614008500 fez GRANT ALL e a 20260702140000 já reduziu os
-- default privileges a SELECT-only, mas o revoke explícito NESTE arquivo é o
-- que nega a escrita de fato e o que a guarda estática [G4] de
-- vitrine_lojas_select_only.test.ts exige.
--
-- SEQUÊNCIA (expand → contract, D3):
--   A (este arquivo) → `db push` → `gen types` → código lê a view (executar)
--   → merge/deploy → B (`drop policy`) → `db push`.
--   B NUNCA vai ao cloud junto com A: `db push` aplica todas as pendentes, e
--   com B aplicada antes do deploy a vitrine cai em `temVazio` SEM erro.
--
-- ROLLBACK: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Vigência de desconto (RN-03) — início inclusivo, fim exclusivo.
create function public.desconto_vigente(
  p_ativo  boolean,
  p_inicio timestamptz,
  p_fim    timestamptz,
  p_agora  timestamptz
)
  returns boolean
  language sql
  immutable
  set search_path = public
as $$
  select coalesce(p_ativo, false)
     and (p_inicio is null or p_inicio <= p_agora)   -- início INCLUSIVO
     and (p_fim    is null or p_agora  <  p_fim);    -- fim EXCLUSIVO
$$;

comment on function public.desconto_vigente(boolean, timestamptz, timestamptz, timestamptz) is
  'RN-03: ativo AND (inicio is null or inicio <= agora) AND (fim is null or agora < fim). Inicio INCLUSIVO, fim EXCLUSIVO. ativo NULL => false. Gate de DIVULGACAO da vitrine (vitrine_produtos); o gate de PRECO e precoEfetivo() em TS, com as mesmas bordas.';

revoke all on function public.desconto_vigente(boolean, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.desconto_vigente(boolean, timestamptz, timestamptz, timestamptz)
  to anon, authenticated, service_role;

-- 2) Projeção pública do catálogo, mascarada por vigência.
create view public.vitrine_produtos
  with (security_invoker = false)
as
  select
    p.id,
    p.loja_id,
    p.categoria_id,
    p.nome,
    p.descricao,
    p.preco,
    p.disponivel,
    p.ordem,
    p.foto_url,
    public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
      as desconto_ativo,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_tipo   end as desconto_tipo,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_valor  end as desconto_valor,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_inicio end as desconto_inicio,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_fim    end as desconto_fim
  from public.produtos p
  where p.oculto = false
    and public.loja_esta_ativa(p.loja_id);

comment on view public.vitrine_produtos is
  'Projecao PUBLICA do catalogo (seguranca.md §19, view definer). WHERE = predicado literal da antiga produtos_leitura_publica (oculto = false AND loja_esta_ativa). desconto_ativo aqui significa "VIGENTE NESTE INSTANTE" (D5); desconto_tipo/valor/inicio/fim so saem quando vigente, senao NULL. NAO calcula preco: precoEfetivo() em TS e a unica fonte. service_role e o painel leem a TABELA.';

-- 3) SELECT-only para os roles da API (§19; guarda estática [G4]).
revoke all on public.vitrine_produtos from anon, authenticated;
grant select on public.vitrine_produtos to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: a qualquer momento ENQUANTO a migration B não foi aplicada e o
-- código ainda lê `public.produtos`. Depois que o código passa a ler a view,
-- derrubá-la derruba a vitrine: reverter primeiro B (recriar a policy) e o
-- código, só então:
--
--   drop view if exists public.vitrine_produtos;
--   drop function if exists public.desconto_vigente(boolean, timestamptz, timestamptz, timestamptz);
--
-- Não perde dado: nenhuma coluna/linha de `produtos` é tocada aqui.
-- ─────────────────────────────────────────────────────────────────────────────
