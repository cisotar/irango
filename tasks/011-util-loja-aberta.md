# [011] Util `lojaAberta` (horário de funcionamento)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-09)

## Objetivo
Função pura que determina se a loja está aberta dado o JSONB `horarios` e um instante. Reusada no badge da vitrine (UX) e na Server Action de criar pedido (bloqueio autoritativo).

## Escopo
- [ ] Criar `src/lib/utils/lojaAberta.ts`
- [ ] `lojaAberta(horarios, agora: Date, timezone: string): { aberta: boolean; reabreEm?: string }`
- [ ] **DELTA Timezone** — usar `loja.timezone` (coluna da issue 001, nunca hardcode SP): converter `agora` (UTC) para o fuso da loja ANTES de derivar dia-da-semana e `HH:MM`, e só então comparar com `horarios`. Borda de virada de dia respeita o fuso da loja
- [ ] Mapear dia da semana → chave (`seg`..`dom`) **no fuso da loja**
- [ ] Dia com `ativo: false` → fechada
- [ ] Comparar `HH:MM` atual (no fuso da loja) entre `abre` e `fecha`
- [ ] Calcular próximo horário de reabertura quando fechada (para o badge)

## Fora de escopo
Hook `useLojaAberta` (027), badge UI (026). Bloqueio do pedido (014, que reusa esta função).

## Reuso esperado
- Tipos de `src/types/supabase.ts` (017)
- Lógica de máscara/comparação de horário do `lojinhaonline` portada em TS

## Segurança
- Mesma função no client (badge) e no servidor (RN-09) — nunca confiar só no client para bloquear pedido

## Critério de aceite
- [ ] (crítica) Teste vermelho: dentro do horário → aberta; fora → fechada com `reabreEm`; dia `ativo:false` → fechada; borda exata de `abre`/`fecha` tratada de forma determinística
- [ ] (crítica, DELTA Timezone) Teste vermelho com loja em fuso diferente de SP (ex.: `America/Manaus` ou `America/Rio_Branco`): um mesmo instante UTC perto da meia-noite cai em dia/`HH:MM` diferente conforme o fuso, comprovando a borda de virada de dia — falha se a função hardcodar SP
