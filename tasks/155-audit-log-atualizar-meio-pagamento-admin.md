# [155] Débito: audit-log em `atualizarMeioPagamentoAssinaturaAdmin`

**crítica:** NÃO
**Mundo:** painel admin / observabilidade
**Origem:** auditoria da issue 151 (finding BAIXA)

## Contexto
As 3 actions de assinatura admin que mudam estado (`iniciarAssinaturaAdmin`, `trocarPlanoAdmin`, `cancelarAssinaturaAdmin`) chamam `registrarAcessoAdmin` (trilha `admin_acessos`). `atualizarMeioPagamentoAssinaturaAdmin` NÃO — mesmo gerando a URL do checkout hospedado que permite alterar o meio de pagamento da assinatura de outro tenant.

Por design a action "não muda estado" (não persiste/revalida), e a variante do lojista (078) também não audita — por isso é BAIXA, não bloqueia. É lacuna de observabilidade/compliance (§7 "quem acessou o quê").

## Escopo
- [ ] Antes do `return { ok: true, url }`, adicionar `registrarAcessoAdmin(svc, { lojaId: validacao.lojaId, acao: "atualizar_meio_pagamento" })` (fire-and-forget, sem metadados de PII).
- [ ] Teste em `admin-assinatura.test.ts`: happy path chama `registrarAcessoAdmin` 1× com `acao: "atualizar_meio_pagamento"`.

## Fora de escopo
- Auditar a action do lojista (comportamento pré-existente, decisão separada).
