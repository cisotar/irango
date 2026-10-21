# 365 — Revogar grants residuais de `itens_pedido` e `itens_pedido_opcionais`

crítica: SIM (grant/RLS em tabela de pedido) · Spec: nenhum

## Origem
Achado BAIXA do `auditar` na issue 330, commit auditado `6fad6f2` (branch fix/330-pedidos-imutaveis-lojista).

## Problema
`supabase/migrations/20260614008500_grants_roles_supabase.sql:20` deu `GRANT ALL` a `anon` e `authenticated` em todas as
tabelas de `public`. A 330 revogou `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER` e `REFERENCES` só em `pedidos`.
`itens_pedido` e `itens_pedido_opcionais` seguem com o `GRANT ALL`. A migration `20260702150000_revoke_grants_residuais.sql`
limpou só `vitrine_lojas` e os default privileges.

Hoje não há vetor explorável: as duas tabelas só têm policy de SELECT, então `UPDATE` e `DELETE` caem no bloqueio padrão da RLS.
`TRUNCATE` ignora a RLS, mas o PostgREST não o expõe e nenhuma função `SECURITY INVOKER` o executa. É defesa em profundidade:
um `CREATE POLICY` futuro mal escrito abriria a escrita sem que o grant segurasse.

## O que fazer
- Migration nova: `revoke update, delete, truncate, trigger, references` de `anon` e `authenticated` nas duas tabelas, deixando só `SELECT`
  (mesmo molde de `20261021120000_pedidos_lojista_so_status_e_frete.sql`).
- Varrer as demais tabelas de `public` que herdaram o `GRANT ALL` e decidir, tabela a tabela, o que fica. Uma tabela por linha no plano.
- Antes de revogar, confirmar que nenhum fluxo do lojista escreve nessas tabelas com a sessão dele (`grep` de `.from("itens_pedido")`).

## Critérios de aceite
- [ ] RED: teste pglite `has_table_privilege('authenticated'|'anon', 'public.itens_pedido', 'DELETE'|'TRUNCATE'|'TRIGGER'|'REFERENCES'|'UPDATE') = false`, o mesmo para `itens_pedido_opcionais`.
- [ ] `asUser(dono)` tenta `DELETE` e `UPDATE` em item da própria loja: recusa `42501` + fragmento `permission denied for table`, releitura via `asService` com a linha intacta.
- [ ] `criar_pedido` (service_role) e as leituras do painel continuam verdes.
