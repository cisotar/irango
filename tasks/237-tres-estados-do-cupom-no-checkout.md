# [237] Os três estados do cupom no checkout: `copiaCupom.ts` + `ResumoValores` + `EtapaItens`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [228] (`tasks/228-revisarcarrinhoaction-preview-igual-ao-autoritativo.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D5, D5-a, D8, D9 · RN-10, RN-10-e · design §6

## Objetivo

Fazer o cliente **entender** por que um cupom de 10% num pedido de R$ 140,00 descontou R$ 6,00, e
não R$ 14,00 — com as três redações literais de RN-10-e num módulo puro, porque sem jsdom é a
única forma de travar copy por teste.

## Escopo

- [ ] `src/lib/utils/copiaCupom.ts` — **puro**, sem React e sem DOM, exportando
      `rotuloLinhaCupom(e)`, `valorLinhaCupom(e): string | null` e `fraseCupom(e): string | null`,
      recebendo a union discriminada `EstadoCupom` que a Server Action devolve;
- [ ] as **três redações literais** de RN-10-e, byte a byte (A sem frase; B com
      *"Não acumula com promoção: o desconto valeu sobre R$ 60,00 do pedido — o que não está em
      promoção, adicionais incluídos."*; C com *"Cupom PROMO10 aplicado. Sem desconto neste pedido:
      não há nada fora da promoção para descontar — cupom não acumula com promoção."*);
- [ ] `ResumoValores` ramifica **só** sobre `estado` (M4): **nunca** compara `baseElegivel` com
      `subtotal`. No estado `zero` a linha de valor não existe — e o campo `desconto` nem está na
      union, então "Desconto R$ 0,00" é impossível de renderizar por acidente;
- [ ] linha "Você economizou R$ X,XX" a partir de `economiaProdutos`, que vem **pronto** do
      servidor; se o número não vier, a linha **não é renderizada** — nunca calculada no cliente;
- [ ] disclosure "Como calculamos" (design §6.4): **fechado por padrão**, **só no estado B**,
      `<button aria-expanded aria-controls>` de 44px, imprimindo `baseProdutos` + `baseOpcionais`
      = "O cupom valeu sobre". Os dois números vêm do servidor; se não vierem, o disclosure não
      é renderizado e a frase obrigatória do estado B sobrevive sozinha;
- [ ] `EtapaItens` chama `revisarCarrinhoAction` no lugar de `validarCupomAction(lojaId, cod,
      subtotal)` — o cliente **deixa de mandar número monetário** (RN-11);
- [ ] mesma linha de economia no drawer `Carrinho`;
- [ ] o bloco do cupom (linha + frase) em `role="status" aria-live="polite"` — **só ele**, nunca o
      resumo inteiro; "Remover cupom" (44×44) continua nos três estados.

## Fora de escopo

A Server Action, os números e a escolha do estado A/B/C (issue 228). `calcularDesconto` e
`derivarBasesCupom` (issue 227). A reconfirmação de preço (issue 238). **Cupom recusado por pedido
mínimo não é um quarto estado**: é o `valido: false` que já existe, com a régua no **subtotal**
(D5-a). Nada de tooltip, `title` ou ícone "?" — no celular nada disso existe.

## Reuso esperado

- `src/lib/utils/alcance-do-grupo.ts` — precedente exato de copy pura testável em
  `environment: node`; mesma forma de módulo.
- `ResumoValores.tsx:47` (`#166534`) e `:73-84` (bloco "Valores estimados") — já existem; o hex
  vira `text-promo-texto` (issue 232), mesmo valor, agora nomeado.
- `formatarMoeda` — único formatador.
- O `Loader2` + `useTransition` + `mensagemCupom` que `EtapaItens` já tem.

## Segurança

- **O componente não recalcula nada.** Todos os números que a frase cita (`desconto`,
  `baseElegivel`, `subtotal`, `baseProdutos`, `baseOpcionais`, `economiaProdutos`) vêm prontos da
  Server Action. Recalcular seria reimplementar a regra por componente no browser — a duplicação
  que D5-b proíbe.
- A union discriminada é a trava: no estado `zero` o número não existe; no estado `cheio` a
  `baseElegivel` não existe.
- **"Base elegível" é proibido na vitrine** — é vocabulário do spec e do código.

## Critério de aceite

- [ ] `copiaCupom.test.ts` afirma as três saídas **literais**, byte a byte, para os três estados;
- [ ] `grep -rn "base elegível\|baseElegivel" src/lib/utils/copiaCupom.ts` não mostra a expressão
      em **nenhuma string** devolvida ao cliente;
- [ ] `grep -rn "subtotal" src/components/vitrine/checkout/ResumoValores.tsx` não mostra nenhuma
      comparação com `baseElegivel`;
- [ ] `grep -rn "validarCupomAction" src/components/` **não devolve nada**;
- [ ] estado C não renderiza nenhuma linha de valor de desconto;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
