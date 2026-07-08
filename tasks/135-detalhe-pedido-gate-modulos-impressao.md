# [135] `DetalhePedido`: prop `modulosImpressao` + seletor + render condicional (RN-M1)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [130], [132], [133], [134]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Ponto de aplicação do entitlement na apresentação: `DetalhePedido` só monta no DOM os
blocos das variantes habilitadas e só mostra o seletor com essas variantes (RN-M1 — bloco
não habilitado **não é renderizado**, nunca só escondido por CSS). Continua Server
Component puro.

## Escopo
- [ ] `src/components/painel/DetalhePedido.tsx`: assinatura
  `{ pedido, basePedidos?, acaoStatus? }` → `{ pedido, basePedidos?, acaoStatus?,
  modulosImpressao }` (`modulosImpressao: VarianteImpressao[]`, decidida no servidor).
- [ ] Renderizar `SeletorImprimirPedido` (132) no bloco do título **somente se
  `modulosImpressao.length > 0`**, passando exatamente essa lista.
- [ ] Renderizar `ComandaCozinha` (133) **só se** `modulosImpressao.includes("cozinha")`;
  `ReciboCliente` (134) **só se** `modulosImpressao.includes("recibo")`. Blocos ausentes do
  DOM quando não habilitados.
- [ ] Marcar como `no-print`: chrome, link "Voltar", card "Ações" (`AcoesStatus`) e o
  seletor (RN-P2). Marcar o detalhe A4 atual como conteúdo `print-a4`. (O gate do layout A4
  formatado é natural: sem `"a4"` na lista o seletor não oferece "Comum (A4)", logo
  `data-print-variant="a4"` nunca é setado — RN-M2 nota do Módulo A.)
- [ ] Nunca renderizar `token_acesso` (invariante atual mantida).

## Fora de escopo
- Resolver o entitlement / I/O da loja (pages 136/137).
- Regras `@media print` (issue 138).

## Reuso esperado
- `SeletorImprimirPedido` (132), `ComandaCozinha` (133), `ReciboCliente` (134),
  `VarianteImpressao` (130) — compor, não reescrever.
- O markup A4 atual de `DetalhePedido` — reuso como bloco da variante 1.

## Segurança
- **RN-M1 (server-autoritativo):** a decisão vem em `modulosImpressao` (calculada no
  servidor por `variantesHabilitadas`). O componente NÃO recebe as flags cruas nem decide
  sozinho — só monta o que o servidor autorizou. Bloco não habilitado **fora do DOM**
  (não basta CSS). Um bug que renderizasse variante não habilitada = burla de entitlement
  observável no "View Source"/print-preview. Motivo da criticidade.

## Critério de aceite
- [ ] (RED-first) `modulosImpressao=[]` → sem seletor e **sem** `ComandaCozinha`/`ReciboCliente`
  no DOM renderizado.
- [ ] (RED-first) `modulosImpressao=["cozinha"]` → só o bloco cozinha no DOM; recibo ausente;
  seletor presente com 1 opção.
- [ ] (RED-first) `modulosImpressao=["a4","cozinha","recibo"]` → os três blocos e seletor com 3 opções.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] `token_acesso` nunca no DOM; `next build` passa.
