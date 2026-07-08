# [137] Página admin `/admin/assinantes/[lojaId]/pedidos/[id]`: espelhar entitlement

**crítica:** SIM (TDD red-first)
**Mundo:** painel (admin SaaS)
**Depende de:** [135], [136]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
O espelho admin herda o seletor com **exatamente** as variantes da loja-alvo (RN-M2 admin
→ espelhar). Como `carregarPedidoDetalheAdmin` só carrega o pedido, é preciso uma leitura
extra ESCOPADA da loja-alvo (flags de módulo) via `service_role` e computar
`variantesHabilitadas` — o mesmo util do painel.

## Escopo
- [ ] Leitura extra da loja-alvo escopada por `lojaId`: reusar `buscarLojaAdminPorId(svc,
  lojaId)` (`queries/lojas.ts`, já `.eq("id", lojaId)`), seguindo o padrão fail-closed dos
  loaders `carga*.ts` (`validarLojaIdAdmin` → prova admin → `service_role`). Preferir
  estender `carga-pedido-detalhe.ts` para devolver também `modulosImpressao`, mantendo a
  ordem inegociável (validar `lojaId` → provar admin → elevar → ler).
- [ ] Computar `variantesHabilitadas(loja)` (130) e passar `modulosImpressao` a
  `<DetalhePedido>` na page admin.
- [ ] **Fail-closed:** loja-alvo `null` → `[]`.

## Fora de escopo
- Override "admin vê todas as variantes" — v1 espelha o entitlement da loja (spec §Fora do Escopo).
- Página do lojista (issue 136).

## Reuso esperado
- `buscarLojaAdminPorId` (`queries/lojas.ts`) — leitura escopada por `id`, já existente.
- `variantesHabilitadas` (130) — MESMO util do painel (um caminho de entitlement, DRY).
- Padrão dos loaders `carga*.ts` (`validarLojaIdAdmin` + prova admin antes de elevar).

## Segurança
- **RN-M1 + isolamento cross-tenant:** a leitura das flags é escopada por `lojaId`
  validado (nunca do payload) e provada como admin ANTES de elevar a `service_role`. O
  admin vê o entitlement da loja-alvo, não o da própria loja. Um bug de escopo aqui leria
  a flag da loja errada. Motivo da criticidade.

## Critério de aceite
- [ ] (RED-first) Admin em pedido de loja-alvo com só A4 → `DetalhePedido` recebe `["a4"]`.
- [ ] (RED-first) A leitura das flags é escopada por `.eq("id", lojaId)` da loja-alvo —
  nunca a loja do admin, nunca outra loja.
- [ ] (RED-first) Loja-alvo sem módulo → `[]`.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] Ordem fail-closed (validar → provar admin → elevar → ler) preservada; `next build` passa.
