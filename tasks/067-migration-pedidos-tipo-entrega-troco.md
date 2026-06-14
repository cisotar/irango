# [067] Migration — `pedidos.tipo_entrega` + `pedidos.troco_para`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Adicionar à tabela `pedidos` as colunas `tipo_entrega` (retirada|entrega, NOT NULL) e `troco_para` (numeric nullable, informativo) — base do wizard de checkout.

## Escopo
- [ ] Criar `supabase/migrations/20260614XXXXXX_pedidos_tipo_entrega_troco.sql`
- [ ] `ADD COLUMN tipo_entrega text NOT NULL DEFAULT 'entrega' CHECK (tipo_entrega IN ('retirada','entrega'))`
- [ ] `ADD COLUMN troco_para numeric(10,2)` (nullable, sem CHECK financeiro — RN-C3)
- [ ] Regenerar `src/types/supabase.ts` (`supabase gen types typescript`)

## Fora de escopo
- View `vitrine_lojas` e `taxa_entrega_fora_zona` (issue 068).
- Lógica de recálculo/uso das colunas (issue 069).
- Schema zod (issue 070).

## Reuso esperado
- Convenção de migration `references/schema.md` §6 (CHECK inline em vez de CREATE TYPE).

## Segurança
- `tipo_entrega` é instrução operacional, não financeira; o servidor o usa para forçar `taxa_entrega=0` (RN-C2) — coberto na issue 069.
- `troco_para` é informativo (RN-C3), nunca entra em cálculo.
- RLS: coberta pelas policies existentes (`pedidos_insert_publico`, `pedidos_acesso_lojista`) — nenhuma policy nova.

## Critério de aceite
- [ ] Migration aplica em DB limpo e em DB com dados (default `'entrega'` preenche linhas existentes).
- [ ] CHECK rejeita `tipo_entrega` fora de {retirada, entrega}.
- [ ] (crítica) Teste vermelho: INSERT com `tipo_entrega='delivery'` falha; `troco_para` aceita NULL e numeric positivo; tipos regenerados expõem as colunas.
