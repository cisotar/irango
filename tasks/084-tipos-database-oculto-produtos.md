# [084] Tipos: `oculto` em `produtos` no `database.types.ts`

**crítica:** NÃO
**Mundo:** infra
**Depende de:** [083]
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Refletir a coluna nova `oculto` em `Row`/`Insert`/`Update` de `produtos` no `src/lib/database.types.ts`, para que queries, actions e schema Zod compilem com o campo tipado.

## Escopo
- [ ] Regenerar via `npx supabase gen types` (preferível) OU patchar à mão `produtos` em `Row` (`oculto: boolean`), `Insert` (`oculto?: boolean`) e `Update` (`oculto?: boolean`).
- [ ] Conferir que `next build`/`tsc` seguem verdes com o tipo novo.

## Fora de escopo
- Qualquer lógica (query/action/UI) — só o arquivo de tipos.

## Reuso esperado
- `src/lib/database.types.ts` — editar o bloco existente de `produtos`, não criar arquivo paralelo.

## Segurança
- Nenhum dado sensível; arquivo de tipos gerado. Sem RLS, sem valor monetário.

## Critério de aceite
- [ ] `produtos.Row.oculto: boolean` presente; `Insert`/`Update` com `oculto?: boolean`.
- [ ] `tsc --noEmit` / `next build` sem erro relacionado a `oculto`.
