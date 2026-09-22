# [289] Sentry pode enviar a URL da confirmação com `token_acesso` em transações de pageload

**crítica: SIM** — vazamento de token de acesso a pedido de qualquer loja para quem tiver acesso
ao projeto Sentry. TDD red-first (é um caso de segurança, mesmo não sendo RLS/dinheiro).

**Depende de:** nada. Pré-existente, não introduzida pela issue 287 — só ficou mais visível porque
287 adensou o tráfego na página de confirmação.

## Origem

Achado do `auditar` na issue 287, commit `9da7cd1`.

## O problema

`sentry.client.config.ts:9-12` tem `tracesSampleRate: 0.1`, o que liga o browser tracing (via
integração default do SDK) para 10% das sessões. Isso gera **transações de pageload**, e a
transação da página `/loja/[slug]/confirmacao?pedido=<id>&token=<token>` carrega a URL completa
em `request.url` — **incluindo o `token_acesso` na query string**.

`src/lib/utils/sentryBeforeSend.ts` (ou equivalente) só cobre **eventos de erro** via
`beforeSend`; não existe `beforeSendTransaction`. Além disso, a lógica de redação existente barra
`token` só quando ele aparece como **chave de objeto** (ex.: em `extra`/`contexts`), não quando
está **dentro de uma string de URL** (`?token=xyz`) — então mesmo um `beforeSendTransaction` novo
precisaria de uma função de redação de URL, não reusar a atual como está.

Quem tiver acesso ao projeto Sentry (equipe iRango, não o lojista) consegue ler `pedido` + `token`
de qualquer loja pelas transações de pageload amostradas — acesso de leitura ao pedido de um
comprador sem ser dono da loja nem o próprio comprador.

## Correção proposta

1. Adicionar `beforeSendTransaction` em `sentry.client.config.ts` (e no `sentry.server.config.ts`
   se também amostrar transações server-side) que redige `token`/`pedido` (ou qualquer parâmetro
   sensível conhecido) de `event.request.url` e de `event.transaction` antes de enviar.
2. Preferir uma função utilitária única de redação de URL (analógica a
   `src/lib/utils/urlHttpsSegura.ts`, mas para mascarar querystring), reusada tanto por
   `beforeSend` quanto por `beforeSendTransaction` — não duplicar a lógica.
3. Escrever teste que prova que uma transação simulada com `request.url` contendo `?token=...`
   sai do `beforeSendTransaction` sem o valor do token.

## Critério de sucesso

- Teste vermelho antes do fix: transação com `token=` na URL passa pelo `beforeSendTransaction`
  atual (inexistente) sem redação.
- Depois do fix: teste verde confirmando que `token`/`pedido` (ou o parâmetro sensível relevante)
  não aparece em texto plano na transação enviada.
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes.
