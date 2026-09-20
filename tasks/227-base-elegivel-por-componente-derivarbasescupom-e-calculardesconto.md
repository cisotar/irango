# [227] Base elegível **por componente**: `derivarBasesCupom` + `calcularDesconto`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [226] (`tasks/226-totaldalinha-e-a-invariante-de-soma.md`) e [223] (`tasks/223-preco-efetivo-e-vigencia.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D5, D5-a, D5-b, D8, D9 · RN-08, RN-09, RN-09-a, RN-10, RN-10-a, RN-10-b, RN-10-c, RN-10-d, RN-10-e
**Fatia crítica:** 3 (`calcularDesconto` + `derivarBasesCupom`) — *a fatia mais perigosa do trabalho inteiro*

## Objetivo

Fazer o cupom parar de acumular com desconto de produto (D5), com a unidade da base sendo
o **componente** e não a linha (D9): sai da base só o preço do produto que efetivamente
recebeu desconto; o opcional, que nunca recebeu desconto (D8), **sempre** entra — inclusive
quando está grudado numa linha promocional.

## Escopo

- [ ] `derivarBasesCupom(linhas: ComponentesLinha[])` em `lib/utils/` devolvendo
      `{ subtotal, baseElegivel, baseProdutos, baseOpcionais }`;
- [ ] `baseElegivel = Σ_linhas [ (produtoTemDesconto ? 0 : arred2(precoProduto × quantidade))
      + Σ_opcionais arred2(opcional.preco × opcional.quantidade) ]`;
- [ ] **o `subtotal` não é recalculado aqui**: `derivarBasesCupom` **reusa `calcularSubtotal`**.
      Duas somas divergindo em um centavo fariam o gate de `pedido_minimo` olhar um número que
      não é o que o pedido grava — e isso não aparece em teste de caso feliz;
- [ ] `calcularDesconto(cupom, bases: { subtotal, baseElegivel })` — assinatura **por objeto
      nomeado, não posicional**: dois `number` adjacentes trocados de ordem compilam, passam no
      `tsc` e produzem desconto errado em produção;
- [ ] gate de `pedido_minimo` **continua olhando o `subtotal`** (D5-a);
- [ ] o cálculo do percentual passa a incidir sobre `baseElegivel`;
- [ ] o clamp passa a ser `Math.min(Math.max(bruto, 0), baseElegivel)` — o teto muda de número,
      não só a fórmula;
- [ ] `ResultadoDesconto` ganha `baseElegivel`, para o caller explicar um desconto zero sem
      refazer a conta;
- [ ] `aplicado` continua significando **"passou no gate de pedido mínimo"**, nunca "descontou
      dinheiro" — não sobrecarregar esse booleano é o que mantém `validarUsoCupom` coerente.

## Fora de escopo

Os três importadores de produção e a UI (issues 228, 229, 237). **`admin-cupom.ts` não muda e
não deve mudar** — ele não é caller de `calcularDesconto` (a única ocorrência ali é um
comentário) e só persiste a definição comercial do cupom. A exigência que permanece é
**negativa**: nenhum cálculo de desconto pode ser acrescentado ao caminho admin.
Nada de cupom que incida parcialmente sobre item promocional — D5 é binário **no componente**.

## Reuso esperado

- `src/lib/utils/calcularTotal.ts` — `calcularSubtotal` e `totalDaLinha` (issue 226);
  **uma soma, uma implementação** (mandato 2).
- `src/lib/utils/calcularDesconto.ts` — é ele que muda, não um módulo novo ao lado.
- `src/lib/utils/validarUsoCupom.ts` — continua recebendo o subtotal como régua de mínimo.
- `src/lib/utils/precoEfetivo.ts` (issue 223) — quem produz `precoProduto` e `produtoTemDesconto`.

## Segurança

- ⚠️ **Armadilha do `× qtd` — vale dinheiro.** O `qtd` que multiplica o opcional é a
  **quantidade do opcional**, não a do produto. Multiplicar pela quantidade do produto infla a
  base ⇒ desconto maior que o devido ⇒ prejuízo do lojista.
- Toda `ComponentesLinha` é montada **a partir do banco** (`buscarProdutosPorIds` +
  `precoEfetivo` + `buscarOpcionaisPorIds`). Do cliente vêm apenas `produto_id`, `quantidade`,
  `opcional_id` e a quantidade do opcional. Nunca no cliente, nunca a partir de número enviado
  pelo cliente.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 3), com o `FAIL` capturado, provando
      **os dois casos canônicos, não um deles**:
      (a) RN-10-a — subtotal 130 / base 50 / desconto 5 / total 125;
      (b) RN-10-d — subtotal 140 / base 60 / desconto 6 / total 134, com a borda de R$ 10,00
      **dentro** da base apesar de estar numa linha promocional;
- [ ] invariante `baseElegivel === arred2(baseProdutos + baseOpcionais)` em **todos** os casos;
- [ ] clamp de RN-10-b: cupom fixo de R$ 80,00 sobre base de R$ 50,00 ⇒ desconto **R$ 50,00**,
      não R$ 80,00 (com o clamp antigo seriam R$ 30,00 de prejuízo do lojista por pedido);
- [ ] caso puro de RN-10-c: carrinho só com a Feijoada 100 @ 20%, **sem nenhum adicional**
      ⇒ base 0, desconto 0, total 80;
- [ ] variação B de RN-10-d: 2 pizzas + 1 borda ⇒ base da linha **R$ 10,00**, não R$ 20,00;
- [ ] gate de D5-a **nos dois sentidos**: aceito com 130 ≥ 100; recusado com subtotal abaixo do mínimo;
- [ ] `derivarBasesCupom(...).subtotal === calcularSubtotal(...)` para todos os casos acima;
- [ ] a suíte atual de `calcularDesconto.test.ts` só muda onde **D5/D9 mudam o número esperado**,
      e a mudança é parte da fase RED, com o número novo vindo do spec — nunca do código;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
