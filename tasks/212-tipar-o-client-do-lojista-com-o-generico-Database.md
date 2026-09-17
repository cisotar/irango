# [212] Tipar o client do lojista com o genérico `Database`

**crítica:** NÃO
**origem:** auditoria da issue 208, commit `b31e037` (débito pré-existente, severidade BAIXA).

## Problema

`src/lib/supabase/server.ts` chama `createServerClient(...)` **sem o genérico `Database`**.
O client do lojista é, portanto, destipado: `.rpc(...)`, `.select(...)` e `.insert(...)` passam
sem checagem nenhuma.

O contraste ficou visível na issue 208. O mesmo desvio — coluna `ordem` ainda não existente em
`src/lib/database.types.ts` — produziu **3 erros de `tsc`** no caminho admin
(`src/app/admin/assinantes/actions/admin-opcionais.ts`, que usa `createServiceClient`, tipado
com `createClient<Database>` em `src/lib/supabase/service.ts`) e **zero** no caminho do lojista
(`src/lib/actions/opcional.ts`), que lê `ordem`, grava `ordem` e chama a RPC nova.

## Por que NÃO é vulnerabilidade

Levantado e descartado na auditoria: PostgREST é fail-closed nessa classe. Coluna desconhecida
em `select`/`eq` → `42703`; coluna desconhecida em `insert` → `PGRST204`; argumento de RPC com
nome errado → `PGRST202`. Todos caem no `if (error)` e devolvem a mensagem genérica.

Não existe caminho em que um filtro de escopo (`.eq("loja_id", …)`) seja *silenciosamente
descartado* por falta de tipo — ele viraria erro, não bypass.

## O que se perde de verdade

Sinal de CI. Um rename de coluna de escopo quebra só em produção, não no gate. E, na prática da
208: **`tsc` verde não é prova de que a migration chegou ao cloud** pelo lado do lojista.

## Escopo

Passar o genérico `Database` em `createServerClient` e resolver o fallout de `tsc` que isso
expuser no código do lojista.

## Pré-requisito de ordem

Fazer **depois** do `db push` da 208. Antes disso, o genérico só acrescentaria erros de `ordem`
ausente nos arquivos do lojista e poluiria o gate com ruído que some sozinho.

## Critério de aceite

- [ ] `createServerClient<Database>` em `src/lib/supabase/server.ts`;
- [ ] `npx tsc --noEmit` com 0 erros;
- [ ] nenhuma supressão (`as any`, `@ts-ignore`, `@ts-expect-error`) introduzida para chegar lá.
