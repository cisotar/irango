# [312] Migrations: coluna `mensagem` + CHECKs e RPC transacional `salvar_modal_sazonal`

**crítica:** SIM (GREEN de 307, 308, 309, 311 nas camadas de banco)
**Mundo:** infra
**Depende de:** 307, 308, 309, 311 (suítes vermelhas com `FAIL` capturado)
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Modelos de Dados; RN-M08, RN-M09, RN-M15)

## Objetivo
Duas migrations aditivas: coluna `mensagem jsonb` com 4 CHECKs e a RPC `SECURITY INVOKER` que grava linha + mensagem + seleção numa transação só.

## Arquivos
- **Criar** `supabase/migrations/20260927120000_modais_sazonais_mensagem.sql`: SQL de §"Coluna nova em `modais_sazonais`", com uma correção obrigatória: o CHECK `modais_sazonais_titulo_sem_invisiveis` é escrito **só com escapes ARE explícitos**, nunca com caractere invisível literal no arquivo:
  `check (titulo !~ '[\u0001-\u001F\u007F-\u009F؜​-‏  ‪-‮⁠-⁯﻿]')`
  (mesmo conjunto dos passos 2 e 3 de `normalizarObservacao`, com U+0009/U+000A incluídos). Conferir com `grep -P '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{FEFF}]'` que o arquivo não tem invisíveis.
- **Criar** `supabase/migrations/20260927121000_rpc_salvar_modal_sazonal.sql`: assinatura e travas S1–S7 de §"RPC `salvar_modal_sazonal`". Molde: `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql`, **mas** com `cardinality()` (nunca `array_length`), `array_ndims <= 1`, `set search_path = public, pg_temp`, `revoke all on function ... from public, anon; grant execute ... to authenticated;` **sem** `service_role`. Mensagens de `raise` estáveis com prefixo `modal_sazonal:` (ex.: `'modal_sazonal: sem sessao'`, `'modal_sazonal: sem posse'`, `'modal_sazonal: modal nao encontrado'`, `'modal_sazonal: selecao invalida'`), as mesmas que as suítes 307/308/309/311 afirmam (o texto que o `tdd` fixou manda).
- **Não tocar:** `20260925140000_modais_sazonais_rls.sql` (já aplicada), políticas RLS, `src/`.

## Pré-checagem no cloud (antes do `db push`, rodar no SQL editor, leitura apenas)
```sql
select id, loja_id, char_length(titulo) as tam
from public.modais_sazonais
where char_length(titulo) not between 1 and 120
   or titulo ~ '[\u0001-\u001F\u007F-\u009F؜​-‏  ‪-‮⁠-⁯﻿]';
```
Zero linhas = push seguro. Qualquer linha = o push aborta inteiro (fail-closed); corrigir o título antes, com autorização.

## Fatos conferidos (o código manda sobre o spec)
- A migration 300 (`20260925140000`) **já está aplicada** no cloud (`npx supabase migration list`). A nota de §"Dependência de deploy" do spec está desatualizada: só as duas novas sobem.
- `db push` é irreversível: **exige autorização explícita do usuário**, e o deploy do código da 314 só vai ao ar depois do push (sem a função, `PGRST202`).
- `src/lib/database.types.ts` não conhece `modais_sazonais`: não regenerar tipos nesta issue (a fronteira `ClientModal` segue na 314).

## Suítes que ficam verdes (casos de banco)
- V4 (307): A30, A8b.
- V5 (308): A6 camada CHECK (tabela e via RPC).
- V6 (309): A8 camada CHECK de forma, A9 (pglite), A29, A10.
- V8 (311): os 6 casos de RN-M15 (pglite) e o positivo de controle.
Os casos de zod/renderer/Action dessas suítes seguem vermelhos até 313/314.

## Behaviors do spec que esta issue fecha (marcar `[x]` no mesmo PR)
- "Gravar título, janela, mensagem, "mostrar promoções junto", categorias e cardápios de uma vez: ou tudo grava, ou nada grava."
- "Não ficar com um rascunho órfão quando a criação de um modal falha no meio."
- "Não conseguir gravar mensagem fora do limite nem com escrita direta no PostgREST usando a própria sessão, seja na tabela, seja chamando a RPC direto."

## Critério de aceite
- [ ] `npx vitest run tests/seguranca/modal-sazonal/` : todos os casos pglite de 307/308/309/311 verdes.
- [ ] `tests/migrations/modais_sazonais_rls.test.ts` continua verde.
- [ ] `grep -n "array_length" supabase/migrations/20260927121000_rpc_salvar_modal_sazonal.sql` vazio; `grep -n "service_role"` vazio; `revoke all ... from public, anon` presente.
- [ ] Arquivo da migration 1 sem nenhum caractere invisível literal.
- [ ] Nenhum `db push` sem autorização.
