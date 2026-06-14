# [068] Migration — `lojas.taxa_entrega_fora_zona` + view `vitrine_lojas`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Adicionar `lojas.taxa_entrega_fora_zona` (numeric nullable; NULL = entrega fora de zona indisponível) e expor a coluna no SELECT da view pública `vitrine_lojas` para o preview de frete fora-de-zona.

## Escopo
- [ ] Criar `supabase/migrations/20260614XXXXXX_lojas_taxa_fora_zona_view.sql`
- [ ] `ALTER TABLE lojas ADD COLUMN taxa_entrega_fora_zona numeric(10,2)` (nullable)
- [ ] `CREATE OR REPLACE VIEW vitrine_lojas` incluindo `taxa_entrega_fora_zona` no SELECT (manter todas as colunas atuais)
- [ ] Regenerar `src/types/supabase.ts`

## Fora de escopo
- Uso do fallback no cálculo de frete (issues 069, 071).
- UI do painel para editar o campo (não nesta issue).

## Reuso esperado
- Definição atual da view `vitrine_lojas` (migration existente / `_sync_cloud_pendente.sql`) — recriar 1:1 + nova coluna.

## Segurança
- RLS: coberta por `lojas_update_proprio` (lojista edita a própria) e pela view `vitrine_lojas` (anon). A view NÃO deve expor colunas sensíveis novas além de `taxa_entrega_fora_zona`.
- Valor monetário lido pela vitrine para preview — autoridade segue no servidor (issues 069/071).

## Critério de aceite
- [ ] Coluna existe e aceita NULL.
- [ ] `SELECT taxa_entrega_fora_zona FROM vitrine_lojas` funciona como anon.
- [ ] (crítica) Teste vermelho: anon lê `taxa_entrega_fora_zona` via `vitrine_lojas`, mas a view NÃO expõe colunas sensíveis (ex.: `hotmart_subscriber_code`, `dono_id`); recriação da view não perde nenhuma coluna pré-existente.
