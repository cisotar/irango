# [070] Util — `normalizarBairro` + frete com fallback fora-de-zona

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Extrair a lógica compartilhada de frete (passos RN-C4 1–5) em `lib/utils/calcularFrete.ts`: função pura `normalizarBairro` e suporte ao fallback `taxa_entrega_fora_zona`, para reuso por `criarPedido` (071) e `calcularFreteAction` (072) sem duplicação.

## Escopo
- [ ] Adicionar `normalizarBairro(b: string): string` — `unaccent`-equivalente em TS (remove acentos via `normalize('NFD')`), `lower`, `trim` (RN-C4 passo 1)
- [ ] Estender `calcularFrete` para receber `taxaForaZona: number | null` e aplicar fallback (RN-C4 passo 4): match falha → usa `taxaForaZona`; se null → `atendido:false`
- [ ] Manter passo 5 (frete grátis por `pedido_minimo_gratis`)
- [ ] Comparação bairro↔`bairros_zona.nome` via `normalizarBairro` em ambos os lados (RN-C4 passo 3)

## Fora de escopo
- Reconciliação CEP↔bairro (issue 064 — fase posterior; RN-C8 trata como risco de negócio aceitável, fora deste escopo).
- Query de zonas no banco (já existe em `lib/supabase/queries/`).
- Server Actions que consomem a função (071, 072).

## Reuso esperado
- `lib/utils/calcularFrete.ts` (`ResultadoFrete`, `ZonaComTaxa`, `EnderecoEntrega`) — estender, não recriar.

## Segurança
- Função pura, sem I/O — autoridade fica nas actions que a chamam server-side.
- RN-C8: normalização nunca reduz frete abaixo do configurado; não casar → fallback (mais caro) ou indisponível, nunca zona mais barata.

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde: "Águas Claras" casa com "aguas claras"; bairro sem zona + `taxaForaZona=8` → taxa 8; bairro sem zona + `taxaForaZona=null` → `atendido:false`; frete grátis quando subtotal ≥ mínimo.
