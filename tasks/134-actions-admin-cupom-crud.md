# [134] Server Actions admin: CRUD de cupom (`criar/atualizar/removerCupomAdmin`)

**crítica:** SIM (TDD red-first)
**Mundo:** painel admin (auth admin)
**Depende de:** 115
**Spec:** specs/paridade-hub-admin-painel.md (rota 5)

## Objetivo
CRUD de cupom da loja-alvo via `service_role` escopado por `lojaId`, com `cupomSchema` revalidado e `loja_id` injetado por construção (nunca do payload).

## Escopo
- [ ] Criar `src/app/admin/assinantes/actions/admin-cupom.ts` (`'use server'`) com `criarCupomAdmin(lojaId, payload)`, `atualizarCupomAdmin(lojaId, id, patch)`, `removerCupomAdmin(lojaId, id)`.
- [ ] Ordem fail-closed: `validarLojaIdAdmin` + `cupomSchema.safeParse` → `prepararContextoAdmin` (`verificarAdminSaaS` fora do try) → `escopo.inserir/atualizar/remover("cupons", ...)`.
- [ ] Tratar `23505` (UNIQUE loja_id+codigo) → "Este código já existe".
- [ ] `patch` sem `loja_id`/`id` (Omit por tipo do wrapper).

## Fora de escopo
UI/page (141). Wrapper `CuponsAdminClient` (136). `validarCupom`/checkout (inalterado).

## Reuso esperado
- `cupomSchema` de `lib/validacoes/cupom.ts`.
- `prepararContextoAdmin`/`escopo`/`validarLojaIdAdmin`/`revalidarLojaAdmin` de `lib/actions/admin-loja.ts`.
- Padrão de `admin-produtos.ts`.

## Segurança
- Valor do cupom é definição comercial, não valor cobrado (autoridade permanece no checkout). `loja_id` injetado pelo wrapper, nunca do payload. Cross-loja por `.eq("loja_id").eq("id")`. Prova de admin antes de elevar. Auto-descoberta por `enforcement`/`isolamento` admin.

## Critério de aceite
- [ ] (RED-first) Admin da loja A não cria/edita/remove cupom na loja B.
- [ ] (RED-first) Código duplicado por loja → erro "Este código já existe" (23505 tratado).
- [ ] (RED-first) `loja_id`/`id` do payload são ignorados (injeção por construção).
- [ ] `enforcement`/`isolamento` admin verdes sem editar as suítes; `next build` ok.
