# [135] Server Actions admin: opcionais (8 variantes `*Admin`)

**crítica:** SIM (TDD red-first)
**Mundo:** painel admin (auth admin)
**Depende de:** 115
**Spec:** specs/paridade-hub-admin-painel.md (rotas 6 e 7)

## Objetivo
As 8 operações de opcionais (biblioteca + associação) da loja-alvo via `service_role` escopado por `lojaId`, com preço validado no servidor e posse de referências provada antes de gravar.

## Escopo
- [ ] Criar `src/app/admin/assinantes/actions/admin-opcionais.ts` (`'use server'`) com: `criarCategoriaOpcionalAdmin`, `atualizarCategoriaOpcionalAdmin`, `removerCategoriaOpcionalAdmin`, `criarOpcionalAdmin`, `atualizarOpcionalAdmin`, `alternarOpcionalAtivoAdmin`, `removerOpcionalAdmin`, `salvarAssociacaoOpcionaisAdmin` — todas `(lojaId, ...)`.
- [ ] Fail-closed padrão: `validarLojaIdAdmin` + zod → `prepararContextoAdmin` → efeito via `escopo.*`.
- [ ] Antes de gravar opcional/associação: provar posse de `categoria_opcional_id` e `categoria_id` (produto) sob `lojaId` via `escopo.buscarPorId` (anti cross-tenant).
- [ ] Associação: DELETE-por-`categoria_id` (substituição do conjunto) — exceção documentada ao wrapper: `svc` cru com `.eq("loja_id", lojaId).eq("categoria_id", …)` explícitos.

## Fora de escopo
UI/pages (142/143). Wrapper `OpcionaisAdminClient` (137). Fiação no cardápio (143).

## Reuso esperado
- `schemaOpcional`/`schemaCategoriaOpcional` de `lib/validacoes/opcional.ts`.
- `prepararContextoAdmin`/`escopo`/`validarLojaIdAdmin`/`revalidarLojaAdmin` de `lib/actions/admin-loja.ts`.
- Padrão de posse de `admin-produtos.ts` (`categoriaPertenceALoja`).

## Segurança
- Preço do opcional é valor autoritativo do servidor (snapshot no checkout); zod (≥0) + CHECK. Posse de ambas as pontas provada sob `lojaId` (RN-O8) — `service_role` bypassa RLS, então a barreira é o `escopo`/`buscarPorId`. DELETE não-single documentado como exceção legítima. Prova de admin antes de elevar. Auto-descoberta por `enforcement`/`isolamento` admin (incl. o `.delete()` cru com `.eq(...)`).

## Critério de aceite
- [ ] (RED-first) Admin da loja A não cria/edita/remove/associa opcional na loja B.
- [ ] (RED-first) Associar `categoria_id`/`categoria_opcional_id` de outra loja é rejeitado (posse).
- [ ] (RED-first) Preço negativo é reprovado antes de tocar o banco.
- [ ] `enforcement`/`isolamento` admin verdes sem editar as suítes; `next build` ok.
