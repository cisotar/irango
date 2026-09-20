# [240] Selo `[PROMO]` na `ComandaCozinha` — sem nenhum valor

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [229] (`tasks/229-criarpedido-snapshot-de-preco-e-a-trava-de-reconfirmacao.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D12 · RN-14-a · design §13.6

## Objetivo

Marcar na comanda que o item é promocional **sem trazer dinheiro para a bancada**: `[PROMO]` depois
do nome, e RN-P1 ("ZERO informação financeira") preservada na letra.

> ⚠️ **Esta issue é `crítica: NÃO`, mas o teste vem ANTES do código.** Ele nasce vermelho
> naturalmente (o selo ainda não existe) e é exigência explícita do Spec A.

## Escopo

- [ ] `src/components/painel/ComandaCozinha.tsx:52` — `[PROMO]` **depois do nome do item, dentro do
      próprio elemento**, quando `preco_original != null`. Nenhum valor em reais, nenhum
      percentual, nenhum código de cupom;
- [ ] forma no papel: mesmo tamanho do nome, **sem negrito**, separado por um espaço — o selo não
      compete com nome e quantidade, que é o que a cozinha lê;
- [ ] se for preciso texto acessível, é **"Item em promoção"** — nunca "Item com desconto"
      (a palavra `desconto` entra no HTML pelo `aria-label` e derruba o teste 2 de RN-P1);
- [ ] **um `it` novo**, com as **duas asserções juntas**:
      `expect(html).toContain("[PROMO]")` **e** `expect(html).not.toContain("R$")`.
      Juntas de propósito: separadas, alguém "conserta" uma e a outra fica órfã.

## Fora de escopo

🔴 **`ComandaCozinha.test.tsx:135-151` NÃO pode ser tocado.** Os três testes atuais de RN-P1
continuam verdes **sem uma única edição**; o teste novo é **acrescentado**, nunca substitui.
**Se o rótulo derrubar um dos três, troca-se o rótulo, nunca o teste.**
O par "de/por" **não vai para a comanda** (é da issue 239, e só para recibo, detalhe, WhatsApp e
confirmação). Rótulos recusados por contrato, não reabrir: `[DESCONTO]` (derruba o teste 2),
`[-R$ 10,00]` (derruba o teste 1), `[PROMO10]` (derruba o teste 3 e vaza estratégia comercial) e
`[-20%]` — que **passa nos três testes e mesmo assim está recusado**, porque é valor: o critério
mecânico é o piso, o julgamento de RN-P1 é o teto.

## Reuso esperado

- `src/components/painel/ComandaCozinha.tsx:17-22` — o cabeçalho que declara RN-P1; ele continua
  verdadeiro depois desta issue.
- `src/components/painel/ComandaCozinha.test.tsx` — a suíte é a régua; só se **acrescenta** a ela.
- `itens_pedido.preco_original != null` (issues 221 e 229) — o gatilho, vindo do banco.

## Segurança

- **RN-P1 não é revertida.** A comanda continua sem subtotal, desconto, taxa, total, pagamento,
  troco, `R$` e código de cupom.
- Os colchetes **não são decoração**: o `]` garante que nenhum dígito vizinho encoste em `PROMO` e
  forme `PROMO10` por acidente de markup — a linha já renderiza `{item.quantidade}×` num `<span>`
  ao lado. É defesa contra falso negativo futuro, não estilo.

## Critério de aceite

- [ ] existe **um `it` novo** com `toContain("[PROMO]")` **e** `not.toContain("R$")` no mesmo teste;
- [ ] `git diff` em `ComandaCozinha.test.tsx` mostra **apenas acréscimo** — nenhuma linha entre
      135 e 151 alterada;
- [ ] item sem `preco_original` não imprime selo nenhum;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
