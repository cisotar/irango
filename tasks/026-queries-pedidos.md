# [026] Queries de `pedidos`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 006, 017
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Queries reusáveis de pedidos: leitura escopada por token (confirmação do cliente), listagem do lojista e métricas do dashboard.

## Escopo
- [ ] Criar `src/lib/supabase/queries/pedidos.ts`
- [ ] `buscarPedidoPorToken(id, token)` — `WHERE id = $1 AND token_acesso = $2`, com itens aninhados (Server Component da confirmação)
- [ ] `buscarPedidosDoLojista(client, lojaId, status?)` — ordenados por `criado_em DESC`, com itens
- [ ] `buscarPedidosRecentes(client, lojaId, limite=20)` — dashboard
- [ ] `buscarMetricasDoDia(client, lojaId)` — pedidos hoje, pendentes, total do dia

## Fora de escopo
Criar pedido (014), atualizar status (033). Leitura apenas.

## Reuso esperado
- `src/lib/supabase/{server,client}.ts`; tipos (017)

## Segurança
- `buscarPedidoPorToken` é a ÚNICA forma do cliente sem login ler o pedido — id + token corretos; sem isso, `notFound()` (seguranca.md §pedidos)
- Listagem do lojista depende de RLS `pedidos_acesso_lojista`

## Critério de aceite
- [ ] (crítica) Teste vermelho: `buscarPedidoPorToken` com token errado retorna null; com par correto retorna o pedido; lojista B não vê pedidos de A na listagem
