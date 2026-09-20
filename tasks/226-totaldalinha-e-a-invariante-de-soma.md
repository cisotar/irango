# [226] `totalDaLinha` + a invariante `Σ totalDaLinha === calcularSubtotal`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D15 · RN-20
**Fatia crítica:** 8 (`totalDaLinha` + invariante de soma)

## Objetivo

Extrair, de dentro de `calcularSubtotal`, a conta de **uma** linha, para que as quatro
superfícies que hoje exibem `(preco + Σ opcionais) × quantidade` passem a exibir o que é
**cobrado**: `(preco × quantidade) + Σ opcionais`. Uma função pura só, não quatro correções.

## Escopo

- [ ] `export function totalDaLinha(item: ItemCalculo): number` em
      `src/lib/utils/calcularTotal.ts`, **ao lado** de `calcularSubtotal`, que já é a autoridade;
- [ ] `calcularSubtotal` passa a ser `arredondar(itens.reduce((acc, i) => acc + totalDaLinha(i), 0))`;
- [ ] teste da invariante `Σ totalDaLinha(item) === calcularSubtotal(itens)` para vários
      carrinhos, **incluindo obrigatoriamente `quantidade > 1` com opcional**;
- [ ] o caso literal de RN-20: 2 pizzas de R$ 50,00 + 1 borda de R$ 10,00 ⇒ **R$ 110,00**,
      nunca R$ 120,00;
- [ ] caso `quantidade = 1` continua dando exatamente o mesmo de antes (R$ 60,00 no exemplo).

## Fora de escopo

As quatro superfícies que vão consumir a função (issue 239) — esta issue entrega a função e
a invariante. **Corrigir só uma tela está errado mesmo que a tela fique certa**, por isso as
quatro andam juntas, na 239, e não aqui.
Nenhuma fórmula nova: `totalDaLinha` é o trecho que o corpo atual **já calcula**
(`arredondar(arredondar(preco × qtd) + Σ arredondar(op.preco × op.qtd))`), extraído.

## Reuso esperado

- `src/lib/utils/calcularTotal.ts` — `arredondar`, `ItemCalculo`, `OpcionalCalculo`; nada novo.
- `calcularTotal.test.ts` — é a régua do refactor, não material a editar.
- a regra da issue 090, documentada no próprio arquivo: *"Opcionais são POR LINHA do item:
  somam UMA vez, sem multiplicar pela quantidade do produto"*.

## Segurança

- 🔴 **O refactor entra no caminho autoritativo de preço.** `calcularSubtotal` é chamada por
  `criarPedido` (`pedido.ts:229`) e pelo preview; um erro aqui muda **o subtotal cobrado** de
  todo pedido do sistema. É por isso que a fatia é `crítica: SIM` apesar de o defeito ser de
  exibição.
- Severidade do defeito original, com todas as letras: **o valor cobrado sempre esteve correto**.
  Nenhum cliente foi cobrado a mais. O dano é de documento — a linha do recibo não fecha com o
  subtotal do mesmo recibo.
- Nenhum número novo passa a vir do cliente.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 8), com o `FAIL` capturado;
      o RED **tem** de incluir `quantidade > 1` com opcional — um teste só com `quantidade = 1`
      passa nas duas fórmulas e não prova nada;
- [ ] **`src/lib/utils/calcularTotal.test.ts` passa sem uma única edição** — se algum teste
      precisar mudar, o refactor mudou comportamento e está errado;
- [ ] a suíte atual de cupom/checkout continua verde **sem reescrever teste existente**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
