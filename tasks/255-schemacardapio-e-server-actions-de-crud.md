# [255] `schemaCardapio` + as Server Actions de CRUD do cardápio

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [242] (`tasks/242-migration-cardapios-checks-de-vigencia-e-rls.md`), [245] (`tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md`) e [253] (`tasks/253-calcularfimdopreset.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2, D3, D3-a, D3-b, D14, D16 · RN-01, RN-02, RN-04, RN-11, RN-14, RN-15
**Fatia:** 9 — a metade de validação e Server Action

## Objetivo

A barreira **legível** que os CHECKs da issue 242 só sabem recusar com `23514`, e as quatro
operações do lojista sobre um cardápio: criar, renomear, ligar/desligar e remover — mais a saída
que a remoção precisa oferecer, "converter os N para o menu".

## Escopo

- [ ] `src/lib/validacoes/cardapio.ts` com `schemaCardapio` (zod), **isomórfico**: o mesmo módulo
      usado pelo form e pela action, nada de schema paralelo (`design-system.md` §6);
- [ ] a disjunção de RN-01 no zod (campos do modo oposto ausentes), o domínio dos dias
      (0..6 e 1..31), o par de horário tudo-ou-nada com `fim > inicio`, e o
      **"pelo menos um eixo"** do modo recorrente, com a mensagem literal do design §9.6:
      *"Escolha pelo menos um dia da semana, um dia do mês ou um horário. Sem nada marcado, este
      cardápio aparece sempre e não é sazonal."*;
- [ ] a action **normaliza array vazio para NULL** antes de gravar — "sem restrição" tem uma
      representação só no banco (RN-02);
- [ ] `prazo_fim` é **recalculado no servidor** por `calcularFimDoPreset` para os presets
      `diario`/`semanal`/`mensal`, **descartando** o `fim` que veio do cliente; só `customizado`
      aceita o digitado (RN-04). O horário local digitado é convertido para instante **no fuso da
      loja**;
- [ ] criação grava `ordem = max(ordem) + 1` da loja — cardápio novo entra no fim (RN-15);
- [ ] `ligarDesligarCardapio` mexe **só** em `ativo`: dias, horários e prazo continuam salvos e
      um clique reverte tudo (RN-03);
- [ ] `removerCardapio` — **recusada** enquanto o cardápio tiver produto exclusivo (RN-14), com
      mensagem legível, e `converterExclusivosParaMenu(cardapio_id)` como a saída oferecida
      (`update produtos set visibilidade = 'menu'` restrito aos vinculados àquele cardápio);
- [ ] `loja_id` sempre de `buscarLojaDoDono`, **nunca** do payload;
- [ ] `revalidatePath` de RN-11: `/painel/cardapios`, `/painel/produtos` e o **slug da própria
      loja**, nunca a forma coringa;
- [ ] teste ao lado do schema para cada recusa; teste da action para o recálculo do `fim` e para
      a recusa de remoção com exclusivo.

## Fora de escopo

A tela da lista (issue 256) e os forms (issues 257–259). A ação em lote e `preverLoteAction`
(issue 251) — **mesmo módulo de validação, funções diferentes**. `contarProdutosEscondidos` e o
aviso de RN-12 (issue 264). Qualquer conversão automática de `visibilidade` pelo sistema: nem ao
expirar, nem ao desligar, nem ao remover o último cardápio.

## Reuso esperado

- `src/lib/validacoes/cardapio.ts` — **o mesmo arquivo** que a issue 251 usa para o zod do lote.
- `buscarLojaDoDono` — fonte única de `loja_id`, padrão de `produto.ts` e `cupom.ts`.
- `src/lib/utils/calcularFimDoPreset.ts` (issue 253) e `src/lib/utils/fusoLoja.ts` (issue 222).
- A divisão zod × CHECK que o projeto já usa em toda parte: zod é a primeira barreira com
  mensagem legível, o CHECK é o backstop.

## Segurança

- Nenhum valor monetário. A autorização é RLS (`cardapios_escrita_propria`) **mais** o `loja_id`
  derivado da sessão: o payload não tem `loja_id` e não teria como ter.
- O `fim` do prazo **nunca** é aceito do cliente em preset — é recálculo no servidor, mesma
  classe do mandato 1 aplicada a data em vez de dinheiro.
- `23514` do CHECK vira mensagem genérica na UI e detalhe no log (§14): o texto cru do Postgres
  não chega ao lojista.
- A recusa da remoção é a **primeira** barreira; a autoridade é o trigger da issue 245, que vale
  inclusive sob `service_role`.

## Critério de aceite

- [ ] recorrente sem nenhum eixo é recusado pelo zod **com a frase literal**, antes de chegar
      ao banco;
- [ ] preset `mensal` com início 31/01 grava `prazo_fim = 28/02`, ignorando qualquer `fim`
      enviado pelo cliente;
- [ ] desligar preserva dias, horários e prazo (asserção sobre a linha inteira);
- [ ] remover cardápio com exclusivo é recusado com mensagem legível, e passa depois da conversão;
- [ ] cardápio novo nasce com `ordem = max + 1`;
- [ ] lojista não consegue tocar cardápio de outra loja nem mandando o `id` no payload;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
