# [017] Tipos TypeScript gerados do schema + tipos de domínio

**crítica:** NÃO
**Mundo:** infra
**Depende de:** 001
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Gerar `src/types/supabase.ts` a partir do schema aplicado e criar `src/types/dominio.ts` com enums/unions de negócio (status de pedido, tipo de cupom, tipo de zona, tipo de forma de pagamento).

## Escopo
- [ ] `supabase gen types typescript` → `src/types/supabase.ts` (ref gdlegxatwylhkjcrusyk)
- [ ] Criar `src/types/dominio.ts` com unions: `StatusPedido`, `TipoCupom`, `TipoZona`, `TipoFormaPagamento`
- [ ] **DELTA Hotmart** — union `StatusAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'cancelada' | 'suspensa'` (bate com o CHECK de `lojas.assinatura_status`). Os tipos gerados já incluem as colunas `assinatura_*`/`hotmart_*` de `lojas` e a tabela `webhook_eventos_hotmart` por virem do schema da issue 001.
- [ ] Tipos auxiliares: `Endereco`, `ItemCarrinho`, `Horarios`, `Tema`
- [ ] **DELTA Timezone/LGPD** — os tipos gerados de `lojas` já incluem `timezone`, `consentimento_em` e `consentimento_versao` (vêm do schema da issue 001); nenhum código manual, só regenerar após 001
- [ ] Documentar comando de regeneração no topo do arquivo gerado

## Fora de escopo
Queries (018+), validações zod (019+).

## Reuso esperado
- `supabase gen types` (CLI) — nunca escrever tipos do banco à mão

## Segurança
- Tipos fortes reduzem `any` e erros de campo monetário.

## Critério de aceite
- [ ] `src/types/supabase.ts` existe e compila (`tsc --noEmit`)
- [ ] Unions de domínio batem com os CHECKs do schema
