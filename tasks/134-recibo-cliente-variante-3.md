# [134] `ReciboCliente` — recibo do cliente (variante 3, não-fiscal)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** —
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Bloco print-only do cupom de cortesia (variante 3): itens + preços + total + dados básicos
do cliente + **aviso não-fiscal obrigatório** (RN-P1 coluna "3. Recibo"; RN-P6). Server
Component puro.

## Escopo
- [ ] Novo `src/components/painel/ReciboCliente.tsx` (Server Component puro). Prop:
  `{ pedido: PedidoComItens }`.
- [ ] Conteúdo (RN-P1): nome da loja no cabeçalho, nº do pedido, data/hora, nome + telefone
  do cliente, tipo/endereço de entrega, itens com preço, opcionais via `ListaOpcionaisItem`
  (COM preço — comportamento atual), subtotal, desconto+código do cupom (se `desconto>0`),
  taxa, **total**, forma de pagamento/troco. Nunca `token_acesso`.
- [ ] **RN-P6:** rodapé fixo visível **"Documento sem valor fiscal — comprovante de
  pedido."** Proibido usar "cupom fiscal"/"nota fiscal" no impresso.
- [ ] Valores = snapshot do pedido (mesma aritmética de exibição de `DetalhePedido`, sem
  recálculo autoritativo). Marcar o bloco com classe de variante (ex.: `print-recibo`);
  print-only.

## Fora de escopo
- Gate por entitlement e render condicional (issue 135).
- Emissão fiscal real (NFC-e/SAT/ECF) — explicitamente fora do spec.
- Regras `@media print` (issue 138).

## Reuso esperado
- `formatarMoeda` e `ListaOpcionaisItem` (com preço, comportamento atual — não usar `ocultarPreco`).
- `PedidoComItens` (`queries/pedidos.ts`).

## Segurança
- Sem recálculo no cliente: exibe `pedido.total`/`subtotal`/etc. do snapshot já lido sob
  RLS/loader. Nunca `token_acesso`.
- RN-P6 é requisito de compliance (não confundir com documento tributário) — critério de
  aceite duro, mas não vetor de money/permissão → NÃO-crítica.

## Critério de aceite
- [ ] Renderiza itens+preços, subtotal, taxa e **total** do snapshot (sem recálculo).
- [ ] Desconto + código do cupom aparecem só quando `desconto > 0`.
- [ ] (RN-P6) Aviso "Documento sem valor fiscal — comprovante de pedido." presente; texto
  "cupom fiscal"/"nota fiscal" **ausente**.
- [ ] `token_acesso` ausente do DOM.
- [ ] Teste de render cobrindo total, aviso não-fiscal e ramo `desconto > 0`; `next build` passa.
