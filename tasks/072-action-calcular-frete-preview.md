# [072] Server Action `calcularFreteAction` (preview de frete)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 070, 068
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Nova Server Action pública `calcularFreteAction(loja_id, bairro)` que retorna `{ taxa_preview, zona_nome | 'fora_zona' | 'indisponivel' }` para estimativa de UX na Etapa 2 — seguindo os mesmos passos RN-C4 do recálculo autoritativo.

## Escopo
- [x] Criar Server Action `calcularFreteAction(loja_id: string, bairro: string)`
- [x] Validar input com zod (`loja_id` uuid, `bairro` string min 1)
- [x] Buscar zonas ativas tipo `bairro` + taxas + bairros via `lib/supabase/queries/`
- [x] Buscar `taxa_entrega_fora_zona` (via `vitrine_lojas`)
- [x] Reusar util de frete (070): match → `{ taxa_preview, zona_nome }`; fallback → `{ taxa_preview, zona_nome:'fora_zona' }`; nada → `{ zona_nome:'indisponivel' }`
- [x] Retornar shape estável para o cliente

## Fora de escopo
- Cálculo autoritativo no envio (issue 071) — esta action é só preview.
- UI da etapa (issue 075).

## Reuso esperado
- `lib/utils/calcularFrete.ts` + `normalizarBairro` (070).
- Query de zonas em `lib/supabase/queries/` (existente).

## Segurança
- Valor monetário de PREVIEW — não autoritativo; o valor final é recalculado em `criarPedido` (071). Mesmo assim recalculado no servidor a partir do banco (cliente nunca envia taxa).
- Action pública (vitrine sem auth); leitura via RLS `zonas_leitura_publica` + view `vitrine_lojas`.

## Critério de aceite
- [x] (crítica) Teste vermelho/verde: bairro em zona → `taxa_preview` da zona + `zona_nome`; bairro fora com fallback → `fora_zona` + taxa; loja sem zonas e sem fallback → `indisponivel`; preview usa exatamente a mesma lib do recálculo autoritativo.
