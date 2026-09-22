# [288] `criarPedido` continua devolvendo `whatsappHref` sem consumidor — dívida de minimização de dado

**crítica: NÃO** — sem RLS, sem dinheiro, sem mudança de comportamento observável; é remoção de
campo morto de um retorno server-side.

**Depende de:** issue 287 (mesclada). Deve ser feita depois, não junto — `pedido.ts` foi
deliberadamente **não tocado** na 287 (decisão 4 do plano `plan/arquivo/loop-aviso-envio-whatsapp-v2.md`).

## Origem

Achado do `auditar` na issue 287, commit `9da7cd1` (base da branch `fix/aviso-envio-whatsapp`).

## O problema

`src/lib/actions/pedido.ts:61,542-555` — `criarPedido` continua montando e devolvendo
`whatsappHref` no retorno da Server Action. Desde a issue 287, **nada no checkout consome esse
campo**: `useEnviarPedido.ts` não lê mais `whatsappHref` (a página de confirmação monta o próprio
link no SSR via `montarLinkWhatsappPedido`, de forma independente).

O `href` carrega nome, telefone e endereço do comprador na query string (PII). Manter um campo
sem consumidor no payload de resposta é ruído contra minimização de dado
(`references/seguranca.md` §20/§21) — não é vazamento novo (o campo já era público para o próprio
comprador), mas é superfície desnecessária: qualquer interceptação do payload de resposta (log de
rede do navegador, extensão, proxy de debug) expõe PII que não precisa mais estar ali.

## Correção proposta

Remover `whatsappHref` do tipo de retorno de `criarPedido` e da montagem interna, já que nenhum
caller usa. Conferir com `grep -rn "whatsappHref" src/` antes de remover — se algum teste ainda
depender do campo, ajustar o teste junto (não é caso de TDD red-first: é remoção de código morto,
sem mudança de comportamento para quem já não lê o campo).

## Critério de sucesso

- `grep -rn "whatsappHref" src/lib/actions/pedido.ts` → zero, ou só onde for genuinamente
  necessário (reavaliar se algum caller apareceu entre a 287 e esta issue).
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes.
