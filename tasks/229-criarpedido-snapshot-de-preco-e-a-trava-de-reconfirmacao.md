# [229] `criarPedido`: snapshot `preco`/`preco_original` + a trava de reconfirmação (RN-12-a)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [221] (`tasks/221-migration-preco-original-em-itens-pedido-e-nova-versao-de-criar-pedido.md`) e [228] (`tasks/228-revisarcarrinhoaction-preview-igual-ao-autoritativo.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D7, D9, D11 · RN-10, RN-12, RN-12-a, RN-13
**Fatia crítica:** 5 (`criar_pedido` + snapshot + trava de D11) — a metade de Server Action

## Objetivo

Fazer o pedido nascer com o preço do banco no momento do envio, gravar o par
preço-pago/preço-de-tabela por item (D7) e transformar o "segundo clique explícito" de D11
em garantia **de servidor**, não de componente.

## Escopo

- [ ] `criarPedido` aplica `precoEfetivo` sobre `buscarProdutosPorIds` e monta, por item:
      `preco` = preço efetivo pago; `preco_original` = preço de tabela **quando houve desconto**,
      **NULL** quando não houve;
- [ ] os dois viajam no jsonb `p_itens` da RPC (issue 221); nenhum campo monetário novo entra
      no schema zod, que continua `.strict()` e continua sem
      `preco`/`subtotal`/`desconto`/`taxa_entrega`/`total`;
- [ ] o desconto de cupom passa a sair de `derivarBasesCupom` + `calcularDesconto` (base elegível),
      no mesmo recálculo;
- [ ] **desconto R$ 0,00 não consome o cupom** (RN-10.3): `p_cupom_id = null` e
      `p_cupom_codigo = null` ⇒ nenhum incremento em `usos_contagem`, nenhum `cupom_codigo` gravado;
- [ ] **RN-12-a**: cada item do payload carrega `promocaoExibida: boolean` (zod, `.strict()`),
      e `criarPedido` compara com o `temDesconto` **real do banco**:
      `true`/`true` segue · `false`/`false` segue · `false`/`true` **segue** (o cliente paga menos
      do que viu) · `true`/`false` **RECUSA** com código de revisão;
- [ ] **ausente ⇒ tratado como `false`** (fail-closed por default): cliente antigo durante a janela
      de deploy segue pelo preço do banco, que é a regra de sempre.

## Fora de escopo

O diálogo de reconfirmação e a faixa de "preço caiu" (issue 238). Nenhum token de revisão
assinado (`revisaoId`): o objetivo foi aceito, **o mecanismo foi recusado** — RN-12-a atinge a
mesma garantia com um booleano assimétrico, sem HMAC, sem tabela nova e sem round-trip.
Nenhuma regra de desconto dentro da RPC: ela é transacional, não é oráculo de preço.
Nada de trancar preço por N minutos: vale o preço do banco no momento do pedido.

## Reuso esperado

- `src/lib/actions/pedido.ts` — é ele que muda; `pedido.ts:174` (recusa de item indisponível)
  continua **inalterado**.
- `precoEfetivo` (223), `derivarBasesCupom`/`calcularDesconto` (227), `calcularSubtotal`/`totalDaLinha` (226).
- `buscarProdutosPorIds` — o ponto autoritativo de recálculo, que já existe.

## Segurança

- **Por que `promocaoExibida` não viola `seguranca.md` §10:** não é campo monetário, é booleano
  de exibição; **a assimetria é a prova** — mentir `false` faz o pedido seguir pelo preço do banco
  (com desconto, como sempre); mentir `true` **recusa**. Não existe valor que o cliente possa
  enviar para pagar menos. Um campo que só sabe travar não é superfície de ataque de valor.
- Os dois preços gravados vêm do **banco**, dentro do mesmo recálculo, e são **imutáveis**:
  editar o produto depois não muda pedido nenhum.
- Erro interno não vaza: mensagem genérica na UI, detalhe no log (`seguranca.md` §14).

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 5), com o `FAIL` capturado;
- [ ] pedido de RN-10-a grava `preco = 80` + `preco_original = 100` na Feijoada e
      `preco_original = NULL` no refrigerante;
- [ ] corrida de RN-12: desconto expirado entre carrinho e envio ⇒ grava **100**;
- [ ] desconto 0 ⇒ `cupom_id`/`cupom_codigo` NULL e `usos_contagem` **inalterado**;
- [ ] **as quatro células da matriz de RN-12-a**, com ênfase em: `true` afirmado × `false`
      apurado ⇒ **recusa**; `false` × `true` ⇒ **segue, e cobra o preço com desconto**;
      e ausente ⇒ tratado como `false`;
- [ ] a suíte atual de cupom/checkout continua verde **sem reescrever teste existente**, exceto
      onde D5/D9 mudam o número esperado — e aí a mudança é parte da fase RED;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
