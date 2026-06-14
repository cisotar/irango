# [025] Queries de entrega, pagamento e cupom

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 005, 006, 017
**Spec:** specs/spec_irango_mvp.md (RN-06)

## Objetivo
Queries reusáveis de zonas/taxas/bairros, formas de pagamento e cupom (busca de UM cupom escopada por loja — nunca lista).

## Escopo
- [ ] Criar `src/lib/supabase/queries/entrega.ts`: `buscarZonasAtivas(lojaId)` (com taxas e bairros aninhados), `buscarZonasDoLojista(client, lojaId)`
- [ ] Criar `src/lib/supabase/queries/pagamento.ts`: `buscarFormasPagamento(lojaId)`
- [ ] Criar `src/lib/supabase/queries/cupons.ts`: `buscarCupom(lojaId, codigo)` (UM registro), `buscarCuponsDoLojista(client, lojaId)`

## Fora de escopo
Validação de validade do cupom (lógica na Server Action 013). Incremento de uso (014).

## Reuso esperado
- `src/lib/supabase/{server,client}.ts`; tipos (017)

## Segurança
- `buscarCupom` retorna UM cupom por `(loja_id, codigo)` — nunca lista cupons ao client (seguranca.md §cupons)
- Como `cupons` não tem SELECT público, esta busca roda no servidor (Server Action), escopada por loja

## Critério de aceite
- [ ] (crítica) Teste vermelho: `buscarCupom` retorna apenas o cupom da loja/código exatos; anon não consegue listar cupons; `buscarZonasAtivas` não retorna zona inativa
