# [136] Página painel `/painel/pedidos/[id]`: resolver entitlement e repassar

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [130], [135]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
A page (Server Component) passa a ler a loja do dono, computar
`variantesHabilitadas(loja)` no servidor e repassar `modulosImpressao` a `DetalhePedido`.
O guard `painel/layout.tsx` lê a loja mas **não** a propaga — a page precisa ler ela mesma.

## Escopo
- [ ] `src/app/(painel)/painel/pedidos/[id]/page.tsx`: além de `buscarPedidoDoDono`, chamar
  `buscarLojaDoDono(supabase)` (reuso da query, **nunca** `.from('lojas')` inline —
  `architecture.md §8`).
- [ ] Computar `variantesHabilitadas(loja)` (130) e passar `modulosImpressao` a
  `<DetalhePedido>`.
- [ ] **Fail-closed:** loja `null` → `variantesHabilitadas(null)` → `[]` → sem seletor
  (v1 silencioso; CTA de upgrade fora de escopo).
- [ ] Manter o `notFound()` do pedido inalterado.

## Fora de escopo
- Página admin espelho (issue 137).
- Alterar o guard `layout.tsx` (fronteira de render distinta — não propaga props a children).

## Reuso esperado
- `buscarLojaDoDono` (`queries/lojas.ts`) — leitura sob RLS, sem query nova.
- `variantesHabilitadas` (130) — mesmo caminho de entitlement do admin (137).

## Segurança
- **RN-M1 (server-autoritativo):** o entitlement é decidido no SSR a partir do banco
  (RLS por `dono_id`), não no cliente. A 2ª leitura de `lojas` é sob RLS (só a própria
  loja). Fail-closed em `null`. Um bug aqui (ex.: passar flags cruas em vez da lista, ou
  não passar) reabriria o vetor de entitlement. Motivo da criticidade.

## Critério de aceite
- [ ] (RED-first) Loja com só térmica → `DetalhePedido` recebe `["cozinha","recibo"]`.
- [ ] (RED-first) Loja sem módulo → recebe `[]` (sem seletor).
- [ ] (RED-first) `buscarLojaDoDono` retorna `null` → `[]` (fail-closed), sem quebrar a página.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] Sem `.from('lojas')` inline; `next build` passa.
