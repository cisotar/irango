# [131] `ListaOpcionaisItem`: prop aditiva `ocultarPreco?: boolean`

**crítica:** NÃO
**Mundo:** vitrine pública (componente compartilhado)
**Depende de:** —
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Permitir renderizar os opcionais de um item **sem o preço**, para a via da cozinha
(variante 2). Extensão aditiva e retrocompatível de `ListaOpcionaisItem` — não duplicar
o componente.

## Escopo
- [ ] `src/components/vitrine/ListaOpcionaisItem.tsx`: adicionar `ocultarPreco?: boolean`
  a `ListaOpcionaisItemProps` (default `false`).
- [ ] Quando `ocultarPreco === true`, **não** renderizar o `<span>` de
  `formatarMoeda(op.preco * op.quantidade)` (só `+ {qtd}× {nome}`).
- [ ] Manter o layout e comportamento atuais quando `ocultarPreco` é omitido/`false`
  (carrinho, checkout, confirmação, `DetalhePedido` — todos os callers intactos).

## Fora de escopo
- `ComandaCozinha` (issue 133 — consome esta prop).
- Qualquer mudança nos callers existentes.

## Reuso esperado
- O próprio `ListaOpcionaisItem` — estender, NÃO recriar (mandato "não reinventar a roda").
- `formatarMoeda` (inalterado).

## Segurança
- Sem valor monetário em risco: a prop só **oculta** um `<span>` de exibição — não
  recalcula nem altera nenhum valor. Sem permissão, sem I/O.

## Critério de aceite
- [ ] Com `ocultarPreco` omitido: renderiza o preço (comportamento atual; snapshot dos testes existentes intacto).
- [ ] Com `ocultarPreco={true}`: nenhum valor monetário no DOM do componente.
- [ ] Todos os callers atuais compilam sem mudança (prop opcional).
- [ ] Teste de render cobrindo os dois modos; `next build` passa.
