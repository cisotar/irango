# [076] Wizard checkout — estrutura + EtapaItens

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 073
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Transformar a página de checkout existente (036) em wizard de 3 etapas: `CheckoutWizard` + `IndicadorEtapas` + `EtapaItens` (revisar itens, alterar quantidade, aplicar cupom via `validarCupomAction`).

## Escopo
- [ ] Criar `components/vitrine/checkout/CheckoutWizard.tsx` — container, estado do wizard em `sessionStorage` (mesmo padrão de `useCarrinho`), navegação client-side
- [ ] Criar `IndicadorEtapas` — 3 passos: "Carrinho", "Entrega", "Pagamento"; etapa atual destacada
- [ ] Criar `EtapaItens` — listar itens (`useCarrinho`), incrementar/decrementar/remover, redireciona para `/loja/[slug]` se vazio
- [ ] Subtotal preview via `calcularTotal` (lib existente)
- [ ] Campo de cupom: ao "Aplicar" chama `validarCupomAction` (073); exibe `desconto_preview`/`mensagem`; "Remover" limpa
- [ ] Total preview sem frete = subtotal − desconto_preview
- [ ] Botão "Continuar" habilitado só com carrinho não vazio
- [ ] Refatorar `/loja/[slug]/pedido/page.tsx` para renderizar o wizard

## Fora de escopo
- EtapaEntrega (077) e EtapaPagamento/envio (078).
- Lógica autoritativa de cupom (já em 071/073).

## Reuso esperado
- `useCarrinho` (027), `calcularTotal`/`calcularDesconto` (libs), `validarCupomAction` (073), `formatarMoeda` (007).
- shadcn/ui `Card`/`Button`/`Input`/`Progress`/`Separator`, sonner `toast`.

## Segurança
- Subtotal/desconto exibidos são PREVIEW de UX — valor autoritativo é o servidor (071). Cliente não envia valores monetários.

## Critério de aceite
- [ ] Wizard renderiza 3 passos com indicador; etapa 1 ativa por padrão.
- [ ] Alterar quantidade/remover item reflete no subtotal preview.
- [ ] Aplicar cupom válido mostra desconto preview; cupom inválido mostra mensagem.
- [ ] Carrinho vazio redireciona para a loja.
