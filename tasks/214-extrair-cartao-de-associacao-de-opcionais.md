# [214] Extrair o cartão de associação de opcionais para `components/painel/`

**crítica:** NÃO
**origem:** `plan/loop-refat-modal-de-opcionais-por-categoria.md` (refat do modal de opcionais por categoria de produto).
**depende de:** nada — pode rodar em paralelo com a 215.

## Problema

`CartaoAssociacao` vive embutido em
`src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx` (a partir da
linha ~1099), um arquivo de 1468 linhas. Esse cartão é a aba "Por categoria de produto": um
por categoria de produto, com lista segmentada (grupos marcados em cima na ordem da vitrine,
disponíveis embaixo), checkbox na própria linha e autosave coalescido. Entregue na 213.

A 216 vai acrescentar a sanfona de itens dentro dele, e a 217 vai renderizá-lo também em
`/painel/produtos`. Enquanto ele estiver preso no `OpcionaisClient`, as duas telas ou
compartilham um import atravessado de rota, ou ganham duas cópias que envelhecem separadas.

## Escopo

Mover `CartaoAssociacao` para `src/components/painel/CartaoAssociacaoOpcionais.tsx`, com
`OpcionaisClient` passando a importá-lo. Levar junto os helpers que só ele usa (ex.:
`rotuloItens`). **Zero mudança de comportamento** — nem de markup, nem de props, nem de
mensagem de acessibilidade.

## Fora de escopo

Sanfona de itens (216), modal (217), qualquer mudança visual e qualquer mudança nas actions.

## Critério de aceite

- [ ] `src/components/painel/CartaoAssociacaoOpcionais.tsx` existe e exporta o cartão;
- [ ] `OpcionaisClient.tsx` **só encolhe** em `git diff --stat`;
- [ ] os testes existentes de `OpcionaisClient.test.tsx` e
      `ReordenarOpcionaisDaCategoria.test.tsx` passam **sem edição** — teste alterado nesta
      issue é sinal de que o comportamento mudou, e é motivo de parar;
- [ ] `npx tsc --noEmit` e `npm run lint` com 0 erros;
- [ ] `npm run build` **não** é obrigatório aqui: a issue não toca arquivo com `'use server'`.
