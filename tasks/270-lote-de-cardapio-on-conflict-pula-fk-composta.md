# [270] Lote de cardápio: `ON CONFLICT DO NOTHING` pula a FK composta quando o par alheio já existe

**crítica: SIM** — escopo de escrita multitenant e log de auditoria; TDD red-first (`tdd` antes de
`executar`). Severidade da auditoria: **BAIXA** (a invariante multitenant segue intacta).

**Depende de:** [269] (mergeada — o caminho admin existe a partir dela).

## Origem

Auditoria de segurança da issue 269 (`fde9bf0`, branch `feat/269-cardapio-hub-admin`). Prova em
pglite já no repo: `tests/migrations/cardapio_produtos_on_conflict_pula_fk.test.ts` (3 casos,
verdes — eles documentam a semântica do Postgres, não o fix).

## O problema

`aplicarCardapioEmProdutosAdmin` (`src/app/admin/assinantes/actions/admin-cardapios.ts:340-386`) e
`aplicarCardapioEmProdutos` do lojista (`src/lib/actions/cardapio.ts:92-127`) afirmam no docstring que
"id alheio ou inexistente derruba o lote inteiro pelas FKs compostas". Vale para par **novo**. Se o par
`(cardapio_id, produto_id)` **já existe** na loja dona dele, o `ON CONFLICT (cardapio_id, produto_id)
DO NOTHING` gerado por `ignoreDuplicates: true` descarta a linha **antes** de a FK
`(cardapio_id, loja_id)` ser avaliada.

Vetor: admin em `/admin/assinantes/<A>/cardapios/<x>` envia `{ cardapio_id: <cardápio da loja B>,
produto_ids: [<produto já vinculado a ele na B>] }` → upsert termina sem erro → action devolve
`{ ok: true }` → `registrarAcessoAdmin` grava `cardapio.aplicar_produtos` com `loja_id = A` e
`entidade_id = <cardápio da B>`.

Impacto: (a) sucesso reportado por escrita que não aconteceu; (b) linha em `admin_acessos` apontando
para entidade de outro tenant. Nenhuma linha cruza lojas. Não é oráculo novo:
`cardapio_produtos_leitura_publica` já expõe vínculos de loja ativa.

## Correção proposta

Provar a posse do `cardapio_id` na loja-alvo **antes** do upsert, nos dois mundos, com o que já existe:

- admin: `escopo.buscarPorId("cardapios", cardapio_id, "id")` → `null` ⇒ `{ ok: false, erro:
  MSG_GENERICA_LOTE }` (mesma frase de id inexistente — sem oráculo), e `registrarAcessoAdmin` **não**
  é chamado;
- lojista: `buscarCardapioPorId(supabase, loja.id, cardapio_id)` com o mesmo desfecho.

Não é TOCTOU: cardápio não muda de loja. Alternativa mais forte, se preferida: `select("*", { count:
"exact" })` no upsert e tratar `count === 0` com lote não-vazio como "nada aplicado" antes de logar.

## Critério de aceite

- [ ] RED em `admin-cardapios.paridade.test.ts`: cardápio alheio com par existente ⇒
      `{ ok: false, erro: MSG_GENERICA_LOTE }` e `registrarAcessoAdmin` não chamado.
- [ ] Mesmo caso no caminho do lojista (`cardapio.test.ts` ou equivalente).
- [ ] Mensagem byte a byte igual à de id inexistente (`seguranca.md` §14).
- [ ] Docstrings dos dois callers deixam de afirmar que a FK derruba o lote em todo caso.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
