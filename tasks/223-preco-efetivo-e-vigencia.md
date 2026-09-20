# [223] `precoEfetivo()` — o preço com desconto e a regra de vigência

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [219] (`tasks/219-migration-colunas-de-desconto-em-produtos-e-checks.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1 · RN-01, RN-02, RN-03, RN-04, RN-05
**Fatia crítica:** 1 (`precoEfetivo` + vigência)

## Objetivo

Criar **o único lugar do projeto onde desconto de produto vira preço**. Função pura, com
`agora` injetado por parâmetro, usada pelo SSR da vitrine, pelo preview do carrinho, pelo
recálculo autoritativo do pedido **e** pela prévia do painel — uma implementação, quatro
consumidores (D5-b nasce daqui).

## Escopo

- [ ] `src/lib/utils/precoEfetivo.ts` com `precoEfetivo(produto: ProdutoComDesconto, agora: Date): ResultadoPrecoEfetivo`;
- [ ] `percentual` ⇒ `arredondar2(preco − preco × valor / 100)`; `fixo` ⇒ `arredondar2(preco − valor)`;
- [ ] **piso em zero** (`Math.max(0, …)`) — terceira camada de RN-04/RN-05: nem uma linha
      impossível que escape de todos os CHECKs produz preço negativo;
- [ ] vigência de RN-03: vigente ⟺ `desconto_ativo = true` **e**
      (`desconto_inicio is null` ou `desconto_inicio <= agora`) **e**
      (`desconto_fim is null` ou `agora < desconto_fim`) — **início inclusivo, fim exclusivo**,
      a mesma convenção de `lojaAberta` e de `validarUsoCupom`;
- [ ] o resultado carrega o que o contrato de catálogo vai precisar: preço efetivo,
      se há desconto vigente e o rótulo pronto do selo (`"-20%"` / `"-R$ 10,00"`);
- [ ] teste ao lado do módulo com os casos literais da fatia 1.

## Fora de escopo

O objeto `ProdutoVitrine` e a projeção (issue 224). Qualquer leitura de `Date.now()` dentro
da função — `agora` entra **sempre** por parâmetro, senão o teste não é determinístico e a
vitrine passa a depender do relógio de quem renderiza.
Nenhuma aritmética de fuso aqui: `timestamptz` é instante absoluto e comparar instante com
instante não precisa de fuso (RN-03); introduzir fuso nessa comparação seria criar um bug.

## Reuso esperado

- `src/lib/utils/calcularTotal.ts` — o `arredondar` do projeto; não escrever outro.
- `src/lib/utils/formatarMoeda.ts` — para o rótulo `-R$ 10,00`.
- `src/lib/utils/validarUsoCupom.ts` — precedente da convenção de borda (`<= agora` esgota).

## Segurança

- É valor monetário: o número é produzido **no servidor** a partir de `produtos.preco` +
  colunas de desconto. O cliente recebe pronto e **nunca** recalcula desconto (regra 6 do
  contrato de catálogo). Como a função é pura, ela também serve de preview isomórfico no
  `FormProduto` — o mesmo código, nunca uma segunda fórmula.
- Nenhuma proposta de cache do catálogo: a vigência é avaliada **por request**.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 1), com o `FAIL` capturado;
- [ ] `100 @ 20%` ⇒ `80`; `100 − R$ 30` ⇒ `70`; piso em `0`;
- [ ] fora do prazo ⇒ preço cheio; `desconto_inicio === agora` ⇒ vigente;
      `desconto_fim === agora` ⇒ **não** vigente;
- [ ] `desconto_ativo = false` ⇒ preço cheio **mesmo com prazo vigente** (RN-07);
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
