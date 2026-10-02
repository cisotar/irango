# 334 — Endurecer o trigger de papel em `lojas` e a atribuição de papel antes da posse do e-mail

**crítica:** SIM (TDD red-first)
**Mundo:** auth
**Depende de:** 332
**Spec:** —

## Origem

`auditar` do P5 da issue 332 (branch `feat/332-gate-papel-painel`), dois achados de severidade baixa que não
cabem no ciclo da 332: o primeiro exige migration nova (a `20261001120000_papel_cliente` já está no cloud).

## Problema

1. `lojas_exige_dono_lojista()` (`supabase/migrations/20261001120000_papel_cliente.sql`): para `anon`/`authenticated`
   com `dono_id` diferente de `auth.uid()`, o trigger devolve `new` sem checar papel e confia na policy de `lojas`
   para recusar. Hoje a policy recusa. Se uma policy futura aceitar `dono_id` de terceiro, a regra "conta só-cliente
   nunca é dona de loja" deixa de valer nesse caminho.
2. `cadastrar` (`src/lib/actions/auth.ts`): quando o e-mail já pertence a uma conta não confirmada, o `signUp`
   devolve o id real e `atribuir_papel_inicial` pode fixar `lojista` nessa conta antes de a posse do e-mail ser
   comprovada. O painel continua exigindo e-mail confirmado, então não há acesso indevido; o efeito é o papel
   ficar decidido por quem não provou ser dono do e-mail.

## Direção sugerida

1. Nesse ramo do trigger, recusar (`raise`) em vez de `return new`, sem ler nem gravar papel alheio. Migration nova
   + teste pglite com policy permissiva temporária.
2. Avaliar atribuir o papel só no callback de confirmação, ou aceitar e documentar no ADR. Teste unitário de
   `cadastrar` com `signUp` devolvendo conta existente não confirmada.

## Criticidade

Crítica (TDD red-first): RLS, trigger e autorização.
