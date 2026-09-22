# [287] Dias da semana no lote de produtos do cardápio

**crítica: SIM** — toca o caminho de escrita escopado por `loja_id` nos dois mundos. TDD
red-first.

**Mundo:** `src/lib/validacoes/cardapio.ts`, `src/lib/actions/cardapio.ts`,
`src/app/admin/assinantes/actions/admin-cardapios.ts`.
**Depende de:** nada. Habilita a [288].
**Spec:** `mockups/cardapio-detalhe-refat.md` (decisão 3 do dono do produto).

## Origem

No fluxo novo de adicionar produto ao cardápio, o lojista escolhe os dias na mesma
interação em que escolhe o produto. Hoje nenhum caminho de escrita carrega dias: a action
monta a linha do `upsert` com `{loja_id, cardapio_id, produto_id}` e nada mais, e os dias só
existem depois, via `definirDiasDoVinculo`.

## Escopo

- [ ] `schemaLoteDeProdutos` ganha `dias_semana` **opcional**, mantendo `.strict()`. Mesma
      validação de domínio do `schemaDiasDoVinculo` (inteiros 0 a 6, no máximo 7) e a mesma
      normalização (`normalizarDiasDoVinculo`: deduplica, ordena, `[]` vira `null`).
- [ ] `aplicarCardapioEmProdutos` propaga o valor normalizado para cada linha do `upsert`.
      Ausente continua gravando `null`, que é "todos os dias do cardápio" — comportamento
      de hoje, byte a byte.
- [ ] Mesmo campo e mesma propagação em `aplicarCardapioEmProdutosAdmin`, importando o
      schema e a normalização, sem redeclarar nada.

## Fora de escopo

- **"Adicionar a categoria inteira".** A RPC `aplicar_cardapio_em_categoria` expande a
  categoria dentro da transação e devolve só uma contagem, não os ids, então aceitar dias ali
  exigiria parâmetro novo na função e, portanto, migration. Decidido com o dono do produto:
  fica fora. Esse caminho continua gravando "todos os dias do cardápio" e o lojista ajusta
  nos cards. **Nenhuma migration nesta issue.**
- Qualquer mudança de UI. É a [288].

## Critério de aceite

- [ ] `dias_semana` válido é aceito; valor fora de 0 a 6 é recusado; chave desconhecida
      continua barrada pelo `.strict()`.
- [ ] A linha gravada carrega os dias normalizados; duplicata some, ordem é crescente, lista
      vazia vira `null`.
- [ ] Payload sem o campo produz exatamente a mesma linha de hoje.
- [ ] A trava de posse do cardápio continua de pé nos dois mundos: cardápio de outra loja é
      recusado **antes** de qualquer escrita, com o fragmento literal da mensagem afirmado no
      teste, não só o SQLSTATE.
- [ ] Paridade byte a byte entre lojista e admin em `admin-cardapios.paridade.test.ts`.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
