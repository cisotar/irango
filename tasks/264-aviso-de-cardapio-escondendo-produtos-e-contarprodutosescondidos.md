# [264] RN-12: `contarProdutosEscondidos` + o aviso de cardápio expirado ou desligado

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [261] (`tasks/261-visibilidade-no-painel-formproduto-lote-e-badge.md`), [263] (`tasks/263-secoes-de-destaque-na-vitrine-ancoras-e-nav.md`), [254] (`tasks/254-descrevervigencia-e-proximaabertura.md`) e [256] (`tasks/256-painel-cardapios-lista-com-estado-ao-vivo.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D14 · RN-03, RN-12, RN-13 · design §13.4
**Fatia:** 15

## Objetivo

Com D14, o produto exclusivo de um cardápio expirado ou desligado **sumiu da vitrine** e o
lojista não vê nada: a loja dele parece simplesmente menor. **O painel é o único lugar do sistema
onde esse estado é observável** — sem esta fatia, D14 troca um problema visível por um invisível.

## Escopo

- [ ] `contarProdutosEscondidos(cardapio, produtos, vinculos, agora, timezone)
      : { doMenu: number; sumidos: number }` — **função pura**, com teste ao lado, consumida pelo
      SSR das duas telas e pelos diálogos de desligar/remover (issue 256);
- [ ] o predicado é **um só**: `proximaAbertura === null` cobre **expirado e desligado** (RN-13),
      não são dois casos;
- [ ] aviso em `/painel/cardapios`, na linha do cardápio, com a ordem obrigatória do design
      §13.4 — **primeiro o que sumiu, depois o que continua vendendo**: *"4 produtos sumiram da
      vitrine / Eles são exclusivos deste cardápio. / Outros 7 produtos do menu continuam
      aparecendo e vendendo normalmente."*;
- [ ] **âmbar, nunca vermelho**, com ícone + texto;
- [ ] as duas saídas a um clique, 44px: `[ Religar o cardápio ]` e `[ Devolver os 4 ao menu ]`
      (esta abre `AlertDialog` **nomeando os 4**);
- [ ] versão reduzida na linha do produto em `/painel/produtos`:
      *"sumiu da vitrine — o cardápio Cardápio de Inverno expirou"*, mesmo âmbar, mesmo par de
      saídas no kebab;
- [ ] `src/lib/utils/copiaCardapioPainel.ts` — a copy do aviso e dos rótulos de estado num
      **módulo puro com teste**, não em JSX (sem jsdom, é a única forma de travá-la).

## Fora de escopo

Qualquer conversão automática: **o sistema não desliga, não reativa e não converte nada
sozinho** — nem o cardápio, nem a `visibilidade`. Um conversor automático que devolvesse ao menu
os produtos de um cardápio expirado venderia sopa de cebola em dezembro, exatamente o que D14
existe para impedir. Job/cron de expiração e coluna "expirado" mantida em dia. Os diálogos de
desligar/remover em si (issue 256) — esta issue entrega o **número** que eles consomem e o aviso
da linha.

## Reuso esperado

- `proximaAbertura` (issue 254) — **o mesmo** número que RN-13 usa para decidir se o produto
  aparece. Nunca um segundo critério de "quando volta".
- `vigenciaCardapio.ts` (issue 246) — `cardapioAberto` e a regra do inativo.
- `converterExclusivosParaMenu` (issue 255) e o atalho da issue 261 — **a mesma** Server Action.
- `BadgeStatus` e `AlertDialog`; `alcance-do-grupo.ts` como precedente de copy pura com teste.

## Segurança

- **Preview de UX**: nenhuma decisão depende dos dois números, e eles são recalculados no
  servidor a cada render — o cliente não os envia.
- A conversão em lote é escrita real: `loja_id` de `buscarLojaDoDono`, restrita aos produtos
  vinculados àquele cardápio, e protegida pela RLS e pelo trigger da issue 245.
- Nenhum valor monetário.

## Critério de aceite

- [ ] `contarProdutosEscondidos` tem teste próprio com o cenário 6 literal: "Cardápio de
      Inverno" expirado ⇒ `{ doMenu: 1, sumidos: 1 }` para Coca-Cola e Sopa de cebola;
- [ ] **desligar** e **expirar** produzem o mesmo aviso (um predicado só);
- [ ] a ordem do texto é "o que sumiu" antes de "o que continua vendendo";
- [ ] a copy vive em módulo puro e é afirmada byte a byte no teste;
- [ ] nenhum caminho do código muda `visibilidade` ou `ativo` sem gesto do lojista
      (`grep` nas Server Actions);
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
