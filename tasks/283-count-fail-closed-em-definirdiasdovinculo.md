# [283] `definirDiasDoVinculo` (lojista e admin): recusar em `count !== 1`, não só em `count === 0`

**crítica: SIM** — decisão de escopo multitenant. Severidade da auditoria: **BAIXA**.

**Depende de:** [274] (entregue).

## Origem

Auditoria da issue 274 em `e002c1c`. O plano da 274 (R4) fixou "recusa só em `0` estrito; `null`
não recusa" com o argumento de mock desatualizado — mock não roda em produção.

## O problema

`postgrest-js` devolve `count = null` quando o header `Content-Range` falta e `NaN` quando vem
`*/*`; `NaN === 0` é `false`. Em produção o PostgREST sempre emite `*/N` em PATCH com
`count=exact`, então o risco real é baixo (proxy/CDN futuro removendo o header). O repo já tem o
precedente fail-closed: `admin-status.ts` usa `if (count !== 1)`. Como `unique (cardapio_id,
produto_id)` garante ≤ 1 linha, `count !== 1` é a forma exata.

## Correção proposta

Nas duas `definirDiasDoVinculo*`: `if (count !== 1) return { ok: false, erro: MSG_DIAS_DO_VINCULO }`.
Inverter os casos R4 dos testes (`null`/`NaN` ⇒ recusa, sem log, sem revalidate) e ajustar o
default `count: 1` dos mocks. Avaliar as outras seis actions D8 (`atualizar`, `ligarDesligar`,
`remover`, lojista e admin): mudança de comportamento maior, registrar a decisão.

## Critério de aceite

- [ ] `cardapio.test.ts` e `admin-cardapios.paridade.test.ts`: `count` `null` e `NaN` ⇒ `{ ok: false }`.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
