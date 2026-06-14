# [090] UI checkout/confirmação — exibir opcionais por item + somar no total

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 081, 082, 085, 087
**Spec:** specs/spec_opcionais.md

## Objetivo
Listar os opcionais escolhidos sob cada item no carrinho/checkout (preview) e exibi-los na confirmação a partir do snapshot do banco; o total exibido soma os acréscimos.

## Escopo
- [ ] `Carrinho`/`EtapaItens` listam nome + acréscimo de cada opcional do item (snapshot local do carrinho) — PREVIEW
- [ ] `ResumoValores` reflete o subtotal com opcionais via `calcularTotal` estendido (082) — PREVIEW
- [ ] Confirmação lê `itens_pedido_opcionais` (snapshot, server-side por token) e exibe nome_snapshot + preco_snapshot por item
- [ ] Item sem opcionais mantém layout atual

## Fora de escopo
- Recálculo autoritativo (085 já feito).
- Modal/seleção (087).

## Reuso esperado
- `Carrinho`/`EtapaItens`/`ResumoValores` (existentes) — estender.
- `lib/utils/formatarMoeda.ts`, `calcularTotal.ts` (082).
- Leitura por token server-side da confirmação (existente) — `itens_pedido_opcionais` lido junto com `itens_pedido`.

## Segurança
- Carrinho/checkout exibem PREVIEW; total autoritativo vem do servidor (085).
- Confirmação lê o SNAPSHOT (autoritativo, RN-O6), nunca recalcula a partir de `opcionais` atuais; leitura por token server-side (nunca SELECT anon).

## Critério de aceite
- [ ] Carrinho lista os opcionais escolhidos por item com o acréscimo.
- [ ] Subtotal preview inclui opcionais.
- [ ] Confirmação mostra os opcionais do snapshot (nome + preço do momento do pedido).
- [ ] Item sem opcionais não quebra layout.
