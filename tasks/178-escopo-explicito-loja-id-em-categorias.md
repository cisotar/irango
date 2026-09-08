# [178] `atualizarCategoria`/`removerCategoria` sem escopo explícito por `loja_id`

**crítica:** NÃO (não explorável hoje — a RLS segura; é qualidade + defesa em profundidade)
**Mundo:** painel do lojista
**Depende de:** —
**Origem:** débito registrado em `references/architecture.md` §10 ("issue própria a abrir"),
achado na auditoria da issue 175. Reconfirmado na triagem de `plan/` de 2026-09-08, onde
`plan/arquivo/loop-reordenar-categorias-produtos.md` §8 já mandava abrir a issue.

## Problema

As duas actions de categoria em `src/lib/actions/produto.ts` escrevem filtrando só por `id`,
sem `.eq("loja_id", loja.id)`:

- `atualizarCategoria` (`:262`) — chama `buscarLojaDoDono`, mas usa a loja só para **gravar**
  `loja_id: loja.id` no payload; o `WHERE` é `.eq("id", id)` puro (`:279`).
- `removerCategoria` (`:293`) — não chama `buscarLojaDoDono` **nenhuma vez**; depende 100%
  da RLS (`:299`).

`reordenarCategorias` (`:331`), escrita na issue 175, já segue o padrão correto (escopo
explícito por `loja_id` ALÉM da RLS) — o comentário em `:319` inclusive aponta a divergência.

## Por que não é vulnerabilidade hoje

O PoC da auditoria da 175 provou `affectedRows: 0` numa categoria de outra loja: o `USING`
da RLS torna a linha invisível para o `UPDATE`/`DELETE`. Nada vaza e nada é escrito.

## Por que ainda assim importa

1. **Mentira na UI.** Ambas devolvem `{ ok: true }` quando `affectedRows` é 0 — o lojista vê
   "salvo" numa escrita que não aconteceu.
2. **Bomba-relógio no `atualizarCategoria`.** O `loja_id: loja.id` gravado no payload, num dia
   em que a RLS for afrouxada (ou a action migrar para `service_role`, como já aconteceu com
   as actions admin), vira **sequestro de categoria alheia**: a categoria da outra loja passa
   a pertencer a quem chamou.
3. **Padrão divergente no mesmo arquivo** — `reordenarCategorias` faz certo, as vizinhas não.

## Escopo

- `.eq("loja_id", loja.id)` nas duas actions; `removerCategoria` passa a chamar
  `buscarLojaDoDono`.
- Conferir `affectedRows`/`count` e devolver erro quando 0, em vez de `{ ok: true }` cego.
- Teste que prove: dono de outra loja não altera nem remove, e o retorno **não** é `ok`.

## Fora de escopo

`CAMINHO_PAINEL = "/painel/cardapio"` apontando para rota inexistente (17 `revalidatePath`
no-op) — débito separado do §10, issue própria.
