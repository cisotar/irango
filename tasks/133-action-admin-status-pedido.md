# [133] Server Action admin: `atualizarStatusPedidoAdmin(lojaId, id, novoStatus)`

**crítica:** SIM (TDD red-first)
**Mundo:** painel admin (auth admin)
**Depende de:** 115
**Spec:** specs/paridade-hub-admin-painel.md (rota 4)

## Objetivo
Mudança de status de pedido da loja-alvo em nome do lojista, via `service_role` escopado por `lojaId`, com a máquina de estados revalidada no servidor.

## Escopo
- [ ] Criar `src/app/admin/assinantes/actions/admin-status.ts` (`'use server'`) exportando `atualizarStatusPedidoAdmin(lojaId, id, novoStatus)`.
- [ ] Ordem fail-closed: `validarLojaIdAdmin` → `prepararContextoAdmin(lojaId)` (`verificarAdminSaaS` fora do try) → ler status atual escopado (`escopo.buscarPorId`) → `transicaoPermitida(atual, novo)` no servidor → `escopo.atualizar("pedidos", id, { status })`.
- [ ] `revalidarLojaAdmin` + `registrarAcessoAdmin` (no-op) ao final.

## Fora de escopo
UI/page (140). Parametrização de `AcoesStatus` (124).

## Reuso esperado
- `prepararContextoAdmin`/`validarLojaIdAdmin`/`escopo`/`revalidarLojaAdmin` de `lib/actions/admin-loja.ts`.
- `transicaoPermitida` de `lib/utils/transicaoStatus.ts` (mesma do lojista).
- Padrão de `admin-produtos.ts`.

## Segurança
- Permissão/estado: transição revalidada no servidor (salto/reversão rejeitados). Cross-loja pelo wrapper `escopo` (`.eq("loja_id", lojaId).eq("id", id)`) sob `service_role`. Prova de admin ANTES de elevar (fail-closed). Auto-descoberta por `enforcement-escopo-admin.test.ts`/`isolamento-admin.test.ts` — deve passar sem editar as suítes.

## Critério de aceite
- [ ] (RED-first) Admin da loja A não altera status de pedido da loja B (escopo cross-loja).
- [ ] (RED-first) Transição inválida (salto/reversão) é rejeitada no servidor.
- [ ] Prova de admin propaga (falha antes de qualquer escrita).
- [ ] `enforcement`/`isolamento` admin verdes sem editar as suítes; `next build` ok.
