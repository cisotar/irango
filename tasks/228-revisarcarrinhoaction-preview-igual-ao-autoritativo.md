# [228] `revisarCarrinhoAction` — o preview deixa de receber dinheiro do cliente

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [227] (`tasks/227-base-elegivel-por-componente-derivarbasescupom-e-calculardesconto.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D5, D5-a, D5-b, D9 · RN-10, RN-10-e, RN-11, RN-12
**Fatia crítica:** 4 (preview = autoritativo em `revisarCarrinhoAction`)

## Objetivo

Trocar `validarCupomAction(lojaId, codigo, subtotal_preview)` por uma Server Action que
recebe **itens** e deriva tudo do banco. Hoje o wizard manda um subtotal numérico
(`EtapaItens.tsx:85`); com base elegível, um número vindo do cliente decidiria **qual
parcela do carrinho é descontável** — a definição de oráculo generoso que `seguranca.md`
§10-A proíbe.

## Escopo

- [ ] `revisarCarrinhoAction` com input `{ loja_id, codigo?, itens: [{ produto_id, quantidade,
      opcionais? }] }`, zod `.strict()`, com `.max(MAX_ITENS_PEDIDO)` (mesmo teto de
      cardinalidade de `pedido.ts`, CWE-770);
- [ ] a action monta `ComponentesLinha` de `buscarProdutosPorIds` + `precoEfetivo` +
      `buscarOpcionaisPorIds` e chama `derivarBasesCupom` + `validarUsoCupom` + `calcularDesconto`
      — **a mesma cadeia de funções do autoritativo**, que é literalmente o mecanismo de D5-b;
- [ ] retorno com `estadoCupom` como **union discriminada** já decidida no servidor:
      `{ estado: "cheio", codigo, desconto }` | `{ estado: "parcial", codigo, desconto,
      baseElegivel, baseProdutos, baseOpcionais }` | `{ estado: "zero", codigo }`;
- [ ] retorno com `economiaProdutos` pronto (`Σ (preco − precoEfetivo) × qtd`) — sem ele a linha
      "Você economizou" simplesmente não é renderizada, **nunca** calculada no cliente;
- [ ] retorno com os preços do banco **naquele instante**, para a tela detectar o que mudou (RN-12);
- [ ] 🔴 **fechar a porta de `validarCupom` (`src/lib/actions/cupom.ts:132`)**: ela não tem caller
      de produção, mas é função exportada de arquivo `'use server'` — um endpoint RPC vivo.
      Migrar para o contrato novo **ou** removê-la. **Manter as duas versões não é opção.**

## Fora de escopo

A redação das frases e o layout do resumo (issue 237). A reconfirmação de preço (issue 238).
`criarPedido` (issue 229). **O componente nunca compara `baseElegivel` com `subtotal`** — o
estado A/B/C chega decidido; comparar no browser seria reimplementar a regra monetária lá.
Cupom recusado por pedido mínimo **não é um quarto estado**: é o caminho `valido: false` que
já existe, com a régua no subtotal (D5-a).

## Reuso esperado

- `src/lib/actions/cupomPreview.ts` — é o arquivo que muda; a action nova substitui
  `validarCupomAction`, não convive com ela.
- `src/lib/supabase/queries/produtos.ts::buscarProdutosPorIds` — já é o ponto autoritativo de
  recálculo, já devolve `select("*")` e **não** ganha filtro de vigência.
- `src/lib/utils/rateLimit.ts` — o limite existente (`validarCupom` ~20/min por IP) continua.
- `src/lib/utils/validarUsoCupom.ts`, `calcularDesconto.ts`, `derivarBasesCupom` (issue 227).

## Segurança

- O preview recebe **ids** do cliente ⇒ vetor IDOR/cross-loja. `produto_id` **e `opcional_id`**
  de outra loja têm de ser recusados, escopados por `loja_id`, como `cupom.ts` já faz.
- **Nenhum campo monetário é aceito no input** — `.strict()` garante; o cliente não envia
  subtotal, não envia base, não diz quais itens são promocionais e não decide se um adicional
  é descontável.
- Resposta a cupom inexistente continua **genérica** (anti-enumeração, `seguranca.md` §6).
- Preview que aplica regra mais generosa que o autoritativo é oráculo — a lição já está
  registrada no frete (`seguranca.md` §10-A).

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 4), com o `FAIL` capturado;
- [ ] preview e `criarPedido` devolvem **o mesmo desconto** para o carrinho de RN-10-a
      **e** para o de RN-10-d (é o que tem opcional em linha promocional — o único que pega
      divergência de componente);
- [ ] `produto_id` de outra loja é recusado, **afirmando o fragmento da mensagem** além do
      SQLSTATE; idem `opcional_id`;
- [ ] input com campo monetário é rejeitado pelo `.strict()`; input acima do teto de itens é rejeitado;
- [ ] `grep -rn "subtotal_preview\|validarCupomAction" src/` **não devolve nada** ao fim da issue;
- [ ] a suíte atual de cupom/checkout continua verde **sem reescrever teste existente** para fazer passar;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
