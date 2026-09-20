# [261] D14 no painel: `visibilidade` no `FormProduto`, na ação em lote e o badge na lista

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [244] (`tasks/244-migration-coluna-produtos-visibilidade.md`), [230] (`tasks/230-schemaproduto-estendido-e-server-action-do-desconto.md`), [235] (`tasks/235-bloco-promocao-no-formproduto-e-indicador-na-lista.md`) e [260] (`tasks/260-modo-de-selecao-em-painel-produtos-e-seletor-do-cardapio.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D14 · RN-12, RN-14 · design §13.5
**Fatia:** 17

## Objetivo

Dar ao lojista o **único** lugar onde a declaração de D14 é feita — "do menu" × "de cardápio" —
em duas superfícies com a **mesma** Server Action por trás, com a cópia que ele consegue
verificar sozinho, e o atalho de saída quando a declaração é recusada.

## Escopo

- [ ] `schemaProduto` (`lib/validacoes/produto.ts`) ganha
      `visibilidade: z.enum(["menu","cardapio"]).default("menu")` — **o mesmo default da coluna**,
      para que um form antigo ou um payload sem o campo continuem produzindo o comportamento de
      hoje;
- [ ] `FormProduto` ganha um **`RadioGroup` de duas opções** (não `Switch`: são duas opções
      nomeadas e permanentes), itens de 44px, com a copy literal do design §13.5 — primeira linha
      do Spec B, segunda linha dizendo a consequência:
      *"Aparece sempre no meu menu / Continua vendendo mesmo quando um cardápio dele fecha ou
      expira."* × *"Só aparece quando um cardápio dele estiver aberto / Fora da temporada, ele
      some da vitrine."*;
- [ ] o form **não esconde** a opção quando o produto não está em cardápio nenhum: explica e
      oferece a saída — *"Este produto não está em nenhum cardápio. Escolha um cardápio antes, ou
      deixe-o no menu."* + atalho `[ Escolher um cardápio ]`;
- [ ] a barra de ação em lote da issue 260 ganha **"Marcar como exclusivo de cardápio"** e
      **"Devolver ao menu"**, pela **mesma** Server Action que o form usa;
- [ ] "Devolver ao menu" é **sempre permitido** — é a saída de qualquer estado preso;
- [ ] `Badge variant="secondary"` com o texto literal **`Exclusivo de cardápio`** ao lado do
      `badgeStatus(p)` existente na lista, e **nada** para o produto do menu (o default não
      merece ruído). O mesmo badge por produto no `SeletorProdutosDoCardapio`;
- [ ] a lista passa a indicar de quais cardápios o produto participa e se ele está fora da
      janela **agora**;
- [ ] o atalho **"converter os N para o menu"** do diálogo de remoção de cardápio, chamando
      `converterExclusivosParaMenu` (issue 255).

## Fora de escopo

A recusa de marcar exclusivo sem cardápio **não é testada no componente**: a autoridade é o
trigger da issue 245 e a mensagem legível é a da Server Action. O aviso de RN-12 na linha do
produto (*"sumiu da vitrine — o cardápio X expirou"*) e as duas saídas no kebab são a issue 264.
Qualquer conversão automática de `visibilidade` pelo sistema — converter é gesto do lojista,
sempre; um conversor automático venderia sopa de cebola em dezembro.

## Reuso esperado

- `schemaProduto` e a Server Action de produto (issues 230/235) — **estendidos**, com validação
  isomórfica e **sem schema paralelo** (`design-system.md` §6).
- `RadioGroup` e `Badge` de `components/ui/`; `badgeStatus(p)` já existente na lista.
- A barra de ação e `copiaLotePromocao.ts` da issue 260 — **não** criar um segundo diálogo.
- `converterExclusivosParaMenu` (issue 255).

## Segurança

- `loja_id` de `buscarLojaDoDono`, **nunca** do payload; a autorização é
  `produtos_escrita_propria` (provada na issue 244).
- `visibilidade` **não trafega ao cliente** na vitrine: é entrada da projeção, não campo do
  contrato.
- O trigger da issue 245 é o backstop que vale inclusive sob `service_role`; a Server Action é a
  primeira barreira, com mensagem legível e a saída junto da recusa.
- Nenhum valor monetário.

## Critério de aceite

- [ ] a copy das duas opções é a literal do design, e o default é "Aparece sempre no meu menu";
- [ ] `grep` prova **um só** caminho de escrita de `visibilidade` (form e lote compartilham a
      Server Action);
- [ ] produto do menu **não** ganha badge;
- [ ] "Devolver ao menu" funciona em qualquer estado;
- [ ] a recusa de marcar exclusivo sem cardápio aparece como mensagem legível, não como toast de
      erro genérico;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
