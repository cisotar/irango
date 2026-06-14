# [087] UI vitrine — `ProdutoModal` com opcionais reais + carrinho carrega escolhas

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 081, 082, 083
**Spec:** specs/spec_opcionais.md

## Objetivo
Renderizar no `ProdutoModal` os opcionais reais do produto (hoje aspiracionais no mockup), agrupados por categoria de opcional, com mini-stepper de quantidade; ao adicionar ao carrinho, o item carrega `opcionais: [{ opcional_id, quantidade }]`.

## Escopo
- [ ] `SecaoOpcionais` renderiza grupos (categoria de opcional) + itens vindos da query SSR (081)
- [ ] `MiniStepper` por opcional (qtd 0 → reveal → auto-scroll, conforme mockup)
- [ ] Produto sem opcionais → seção não renderizada
- [ ] Subtotal do item PREVIEW via `calcularTotal` estendido (082) — estético, não autoritativo
- [ ] "Adicionar ao carrinho" grava no `useCarrinho` o item com `opcionais` (só `opcional_id` + `quantidade`, nunca preço)
- [ ] Item esgotado mantém comportamento atual (botão desabilitado, sem opcionais)

## Fora de escopo
- Recálculo autoritativo (085 já feito).
- Listagem de opcionais no carrinho/checkout (089).
- Gestão no painel (088).

## Reuso esperado
- `components/vitrine/ProdutoModal.tsx`, `useCarrinho` (existentes) — estender.
- Markup `.secao`/`.grupo-label`/`.opcional-item`/`.mini-stepper` de `design-claude/vitrine/produto-modal.html`.
- `lib/utils/formatarMoeda.ts`, `calcularTotal.ts` (082), shadcn/ui `Separator`.

## Segurança
- Cliente envia só `opcional_id` + `quantidade` ao carrinho; nenhum preço (RN-O2). Preço real é recalculado no checkout (085).
- Subtotal exibido é PREVIEW (RN-O1).

## Critério de aceite
- [ ] Modal de produto com opcionais mostra os grupos/itens reais da loja.
- [ ] Produto sem opcionais não renderiza a seção.
- [ ] Subtotal preview atualiza ao mexer no stepper.
- [ ] Item adicionado ao carrinho carrega as escolhas de opcional (verificável em devtools/estado do carrinho).
