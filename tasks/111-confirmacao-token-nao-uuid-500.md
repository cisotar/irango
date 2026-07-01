# 111 — Página de confirmação dá 500 em token não-UUID (deveria notFound)

crítica: NÃO (bug de disponibilidade/robustez; não vaza dado)
origem: achado do `verificar` da issue 110 (pré-existente, fora do escopo de 110)

## Contexto

`verificar` da issue 110 (probe contra cloud) achou: a rota
`/loja/[slug]/confirmacao?pedido=...&token=<não-uuid>` retorna **HTTP 500**
com erro Postgres `22P02 invalid input syntax for type uuid`, em vez de
`notFound()`.

Causa: o `token` (e provavelmente o `pedido`) crus são passados direto à query
sem validar formato UUID antes. Quando não-UUID, o Postgres estoura o cast e a
página crasha (vaza erro de PG no 500 em dev; em prod é 500 genérico).

O spec do fluxo de confirmação diz que token errado deve cair em `notFound()`.

## Escopo
- Validar `pedido` e `token` como UUID (zod `.uuid()` ou regex) ANTES da query
  em `buscarPedidoPorToken` / no `page.tsx` da confirmação.
- Não-UUID (ou ausente) → `notFound()` (mesma resposta de token errado válido),
  sem vazar erro de Postgres.
- Confirmar: token UUID errado → `notFound()`; token não-UUID → `notFound()`
  (não 500); token correto → página renderiza.

## Arquivos prováveis
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx`
- `src/lib/supabase/queries/pedidos.ts` (`buscarPedidoPorToken`)

## Critérios
- [ ] Teste: token não-UUID → notFound (não 500); token UUID inexistente → notFound; token correto → ok
- [ ] Validação UUID antes da query
- [ ] build + testes verdes

## Nota
Anti-enumeração já garantida por `id + token_acesso`; este fix só fecha o crash
e a inconsistência de resposta (500 vs notFound). Sem mudança de RLS/schema.
