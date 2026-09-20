# [245] O estado órfão é impossível: trigger de constraint (RN-14) + `produtos_leitura_publica` ajustada

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [243] (`tasks/243-migration-cardapio-produtos-fks-compostas-e-rls.md`) e [244] (`tasks/244-migration-coluna-produtos-visibilidade.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D14 · RN-13, RN-14
**Fatia crítica:** 16 (D14 no banco) — a metade do trigger e da policy

## Objetivo

Tornar **impossível** o produto `visibilidade = 'cardapio'` sem nenhum vínculo — o estado que
some da vitrine sem deixar rastro e que o lojista não consegue diagnosticar — e impedir que o
prato de um cardápio ainda desligado ("Cardápio de Natal" montado em setembro) seja legível por
`anon` com a anon key do bundle.

## Escopo

- [ ] `create or replace function public.checar_produto_exclusivo_tem_cardapio()` exatamente como
      §Modelos de Dados a escreve: `coalesce(new.produto_id, old.produto_id)`, o `exists` em
      `produtos` **antes** do `not exists` em `cardapio_produtos` (a ordem importa — o contrário
      levantaria erro ao apagar o produto), `raise exception 'produto exclusivo sem cardapio: %'`
      com `errcode = 'integrity_constraint_violation'`, `set search_path = public, pg_temp`;
- [ ] `create constraint trigger produtos_exclusivo_tem_cardapio ... deferrable initially deferred
      ... when (new.visibilidade = 'cardapio')` em `public.produtos` (after insert or update of
      `visibilidade`);
- [ ] `create constraint trigger cardapio_produtos_exclusivo_tem_cardapio ... deferrable initially
      deferred` em `public.cardapio_produtos` (after delete) — é a ponta que pega o
      `ON DELETE CASCADE`;
- [ ] `drop policy "produtos_leitura_publica"` + `create policy` com o predicado **atual preservado
      literalmente** (`oculto = false and public.loja_esta_ativa(produtos.loja_id)`) mais o disjunto
      novo (`visibilidade = 'menu' or exists (... cardapio_produtos join cardapios on c.ativo = true)`);
- [ ] o predicado é **diffado** contra `20260621099000_produtos_oculto_rls_publica.sql`, nunca
      reescrito de memória;
- [ ] teste em `tests/migrations/`, asserção 8 (as quatro do trigger): (a) marcar
      `visibilidade = 'cardapio'` num produto sem vínculo **falha no COMMIT**, afirmando o fragmento
      `produto exclusivo sem cardapio`; (b) marcar como exclusivo **e** vincular na mesma transação
      passa; (c) remover o cardápio que deixaria exclusivos órfãos **derruba a transação inteira** —
      as **três** tabelas ficam como estavam; (d) apagar o produto exclusivo passa. **Rodar (a)–(d)
      também `asService`**, provando que `BYPASSRLS` não desliga trigger;
- [ ] teste, asserção 9 (a policy): (a) **não-regressão** — com todos os produtos em `'menu'`, o
      conjunto lido por `anon` é **exatamente** o mesmo de antes (asserção por lista de ids, não
      por "não deu erro"); (b) `anon` **não** lê produto `'cardapio'` com todos os cardápios
      inativos; (c) `anon` **lê** produto `'cardapio'` com pelo menos um cardápio ativo **mesmo
      fora da janela**.

## Fora de escopo

A mensagem legível da Server Action ("escolha pelo menos um cardápio, ou devolva-o ao menu") e o
atalho "converter os N para o menu" (issues 255 e 261) — aqui mora o **backstop**, não a primeira
barreira. Qualquer tentativa de pôr a regra de janela dentro da policy: ela filtra por *"tem algum
cardápio ligado"*, nunca por *"está aberto agora"* (RN-06). Trigger **não** deferido: quebraria o
caso legítimo de criar produto e vínculo na mesma transação.

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`, com transação
  explícita para poder observar a falha **no COMMIT**.
- `20260621099000_produtos_oculto_rls_publica.sql` — **fonte literal** do predicado preservado.
- `public.loja_esta_ativa(loja_id)` — já usada pelo predicado atual; permanece.
- O índice `cardapio_produtos (produto_id)` da issue 243 — o `EXISTS` da policy já tem índice.

## Segurança

- **Esta é a operação de maior risco da fatia**: `drop` + `create` de policy existente. Três travas:
  predicado atual preservado e diffado, `visibilidade = 'menu'` como curto-circuito para 100% das
  linhas pós-244, e a **não-regressão como teste**, não como argumento.
- **O trigger não é RLS**: vale também sob `service_role`, que é o caminho autoritativo do pedido.
  É por isso que ele, e não a Server Action, é a autoridade do estado órfão.
- Produto de cardápio rascunho é **estratégia comercial**: nome e preço do prato de Natal não
  vazam antes da hora.
- `23514`/`raise` viram mensagem genérica na UI, detalhe no log (§14).

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes do trigger e da policy (fatia 16);
- [ ] o RED afirma o **fragmento** `produto exclusivo sem cardapio`, não só o SQLSTATE;
- [ ] no caso (c), `cardapios`, `cardapio_produtos` e `produtos` são conferidas **as três** depois
      do rollback;
- [ ] a não-regressão da policy é asserção de conjunto de ids, comparando antes e depois;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
