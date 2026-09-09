# 184 — remover `salvarTaxa`, Server Action morta e sem caller em UI

crítica: NÃO (dead code contido por RLS, não é vulnerabilidade ativa — mas é superfície desnecessária)

## Origem

Achado do `auditar` durante a revisão da migration da issue #182
(`supabase/migrations/20260909120000_taxas_entrega_zona_id_unique.sql`), 2026-09-09.

## Problema

`src/lib/actions/entrega.ts:56-77` (`salvarTaxa`) é uma Server Action **exportada** que insere em
`taxas_entrega` com `zona_id` vindo do cliente. Grep confirma que não há nenhum caller em componente
de UI — o único lugar que a invoca é `src/lib/actions/entregaPagamento.test.ts`.

Não é vulnerabilidade hoje: a política RLS `taxas_escrita_propria` contém o escopo corretamente. Mas
é uma Server Action exportada (logo acessível por POST direto, fora do fluxo normal da UI) sem
propósito em produção — superfície de ataque desnecessária (mandato "não reinventar a roda" também
vale ao contrário: não manter código morto).

Com o índice único da issue #182 no lugar, `salvarTaxa` chamada numa zona que já tem taxa passa a
falhar com `23505` (unique violation) em vez de silenciosamente criar duplicata — o que reduz o dano,
mas não remove a superfície.

## O que fazer

- Confirmar que remover `salvarTaxa` não quebra `entregaPagamento.test.ts` de forma que revele uso
  real (se o teste só existe para testar a função morta, remover teste e função juntos).
- Remover a função e seu export de `src/lib/actions/entrega.ts`.

## Arquivos prováveis

- `src/lib/actions/entrega.ts:56-77`
- `src/lib/actions/entregaPagamento.test.ts` (conferir se depende de `salvarTaxa`)
