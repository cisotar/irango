# [145] Implementar `registrarAcessoAdmin` — trilha de auditoria das ações admin

**crítica:** NÃO (BAIXA — débito de plataforma, flagado 3× em auditorias: spec 4, issue 142, issues 143/144)
**Mundo:** painel admin (SaaS)
**Origem:** auditorias recorrentes — LGPD + billing

## Contexto
`registrarAcessoAdmin` (`src/lib/actions/admin-loja.ts`) é **no-op documentado**. Ações
admin sob `service_role` — incluindo ligar/desligar **módulo pago** (issue 142,
`alternarModuloImpressao`, que já monta o payload `{ modulo, ativo, coluna }`) e
visualizar PII de pedidos de assinantes (loader admin) — não deixam registro de
quem/quando/o quê. Implicação de receita (billing) + LGPD (acesso a PII cross-tenant).

## Escopo (a validar no planejamento)
- [ ] Tabela `admin_acessos` (ou nome consistente com schema.md): `id, admin_user_id,
  loja_id, acao, metadados jsonb, criado_em` — **migration com RLS na mesma migration**
  (deny-all a lojista/anon; INSERT só service_role; SELECT só admin).
- [ ] `registrarAcessoAdmin` passa a persistir (fire-and-forget: falha de log NUNCA
  bloqueia a ação principal).
- [ ] Callers existentes já passam payload — zero mudança nos call sites.

## Critério de aceite
- [ ] Toggle de módulo (142) gera linha de auditoria com admin/loja/flag/valor.
- [ ] Falha no INSERT de log não quebra a action principal.
- [ ] RLS: lojista não lê nem escreve a tabela (teste negativo pglite).
