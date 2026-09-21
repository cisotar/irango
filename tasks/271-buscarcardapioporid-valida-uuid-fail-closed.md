# [271] `buscarCardapioPorId` valida o formato do id antes de tocar o banco (fail-closed)

**crítica: NÃO** — não é oráculo nem vazamento; é desvio do padrão de `seguranca.md` §7.
Severidade da auditoria: **BAIXA**.

**Depende de:** nada (vale para lojista e admin desde a 257/269).

## Origem

Auditoria de segurança da issue 269 (`fde9bf0`).

## O problema

`cardapioId` da URL vai direto em `.eq("id", cardapioId)` em
`src/lib/supabase/queries/cardapios.ts:236-253` (`buscarCardapioPorId`). Callers:
`src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.ts` e
`src/app/(painel)/painel/(bloqueavel)/cardapios/[cardapioId]/page.tsx`.

`GET /admin/assinantes/<uuid>/cardapios/abc` ⇒ PostgREST `22P02` (`invalid input syntax for type
uuid`) ⇒ `throw error` ⇒ não há `error.tsx` em `src/app/admin/**` ⇒ página de erro padrão do Next
(500) em vez de `notFound()`. Em produção o Next troca a mensagem por digest, nada do Postgres vaza.
Ocorre depois de `verificarAdminSaaS()` no admin; no lojista, depois do guard do layout.

`seguranca.md` §7 fixa: "`lojaId`/`id` validados por `schemaUuid` antes de tocar o banco — formato
inválido é fail-closed `[]`/`null`". `queries/pedidos.ts:144` segue; `buscarCardapioPorId` não.

## Correção proposta

Em `buscarCardapioPorId`, antes da query:

```ts
if (!schemaIdCardapio.safeParse(id).success) return null;
```

`schemaIdCardapio` já existe em `src/lib/validacoes/cardapio.ts:65`. Uma linha fecha os dois mundos e
mantém `notFound()` byte a byte igual ao de id inexistente ou alheio.

## Critério de aceite

- [ ] Teste unitário em `queries/cardapios.test.ts`: `id = "abc"` ⇒ `null` **sem** chamar `.from()`.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
