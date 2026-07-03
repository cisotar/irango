# [131] Variante de query de cupons escopada por `lojaId` (`svc, lojaId`)

**crítica:** SIM (TDD red-first)
**Mundo:** infra (query server-only)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 5 e §Modelos)

## Objetivo
Criar a leitura de cupons da loja-alvo sob `service_role`, escopada por `lojaId`, para a página de cupons do admin. Cupons nunca têm SELECT público.

## Escopo
- [ ] Em `lib/supabase/queries/entregaPagamento.ts`, criar `listarCuponsDaLoja(svc, lojaId)` espelhando `listarCuponsDoDono` mas com `.eq("loja_id", lojaId)` explícito.
- [ ] Retornar o mesmo tipo `Cupom[]`.

## Fora de escopo
Page admin de cupons (141). Actions admin (134). Wrapper (136).

## Reuso esperado
- `listarCuponsDoDono` como referência de projeção.
- Client `service_role` de `lib/supabase/service.ts`.

## Segurança
- Cross-tenant: `service_role` bypassa RLS — isolação só pelo `.eq("loja_id", lojaId)`. Cupom é dado comercial sensível, nunca exposto publicamente (`seguranca.md` §cupons).

## Critério de aceite
- [ ] (RED-first) Teste de isolamento: `listarCuponsDaLoja(svc, lojaA)` nunca retorna cupom da loja B.
- [ ] Query de loja A retorna exatamente os cupons de A.
