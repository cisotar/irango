# 324 — Tipar o client Supabase do servidor com `<Database>`

## Origem

`auditar` @ `c827180` (P6 do loop `plan/loop-frequencia-exibicao.md`, vetor 4).

## Problema

`src/lib/supabase/server.ts:7` chama `createServerClient(...)` sem o genérico
`<Database>`. O padrão do `@supabase/ssr` é `any`
(`node_modules/@supabase/ssr/dist/main/createServerClient.d.ts:8`), o que dá
`SupabaseClient<any>`: `.rpc(nome, args)` e `.from(t).update(patch)` aceitam qualquer
nome, argumento ou coluna. Na branch da frequência, uma RPC tipada no schema errado
(`graphql_public` em vez de `public`) compilou na chamada do lojista. O
`createServiceClient` do admin é tipado.

Sem risco de segurança: um nome errado falha no PostgREST (PGRST202/PGRST204) e a
action devolve a mensagem genérica. O risco é funcional: o erro só aparece no cloud.

## Correção proposta

`createServerClient<Database>(...)` em `src/lib/supabase/server.ts` e no
`middleware.ts`; corrigir os erros de tipo que aparecerem.

## Critério de pronto

`npx tsc --noEmit` verde com o client tipado; um `.rpc("nome_inexistente")` no client
do lojista deixa de compilar.

## Criticidade

Não crítica (sem TDD red-first): só tipagem.
