# [133] `ComandaCozinha` — via da cozinha (variante 2, sem preços)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [131]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Bloco de preparo print-only (variante 2): itens + quantidades + opcionais + observações,
**sem nenhuma informação financeira** (RN-P1, coluna "2. Via cozinha"). Server Component
puro.

## Escopo
- [ ] Novo `src/components/painel/ComandaCozinha.tsx` (Server Component puro — sem
  `'use client'`, sem I/O). Prop: `{ pedido: PedidoComItens }`.
- [ ] Conteúdo (RN-P1): nº do pedido (`id[0:8]` maiúsculo), data/hora, nome do cliente,
  tipo de entrega, bairro (endereço resumido), itens (**qtd em destaque**), opcionais via
  `ListaOpcionaisItem` **com `ocultarPreco`** (131), observações **em destaque**.
- [ ] **NÃO** renderizar: preço unitário/linha, subtotal, desconto, taxa, total, forma de
  pagamento, telefone (coluna "2" nega tudo isso). Nunca `token_acesso`.
- [ ] Marcar o bloco com classe de variante (ex.: `print-cozinha`) para o CSS de 138;
  print-only.

## Fora de escopo
- Gate por entitlement e renderização condicional (issue 135 decide se aparece).
- Regras `@media print` (issue 138).

## Reuso esperado
- `ListaOpcionaisItem` com `ocultarPreco` (131) — não duplicar renderização de opcionais.
- `PedidoComItens` (`queries/pedidos.ts`) — mesmo shape que `DetalhePedido` consome.

## Segurança
- Reduz exposição por design (zero financeiro). Renderiza só o snapshot já carregado
  (RLS/loader) — sem I/O, sem recálculo. Nunca `token_acesso`.
- Não decide entitlement (135 controla se é montada) → NÃO-crítica.

## Critério de aceite
- [ ] Renderiza itens/qtd/opcionais/observações; opcionais **sem** valor monetário no DOM.
- [ ] **Nenhum** campo financeiro (subtotal/desconto/taxa/total/pagamento) e **nenhum**
  `token_acesso` presentes no DOM.
- [ ] Teste de render confirmando ausência de valores e presença de itens/observações.
- [ ] `next build` passa.
