# [253] `calcularFimDoPreset` — diário / semanal / mensal, com clamp de fim de mês

**crítica:** NÃO
**Mundo:** infra
**Depende de:** [222] (`tasks/222-extrair-fusoloja-de-lojaaberta.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D3-b · RN-04 · design §9.3
**Fatia:** 7

## Objetivo

Uma função pura para a única aritmética de data do Spec B que tem armadilha real:
`Date.prototype.setMonth` **transborda** (31/01 + 1 mês vira 03/03, não 28/02). A mesma função
serve o preview do form e o valor que a Server Action grava — nunca duas fórmulas.

## Escopo

- [ ] `calcularFimDoPreset(inicio: Date, preset, timezone: string): Date` em `src/lib/utils/`;
- [ ] `diario → inicio + 1 dia`, `semanal → inicio + 7 dias`,
      `mensal → inicio + 1 mês com CLAMP para o último dia do mês de destino` (mesma semântica do
      `interval '1 month'` do Postgres);
- [ ] `customizado` **não passa por aqui**: é o único caso em que o `fim` digitado é aceito (RN-04);
- [ ] teste ao lado do módulo com os casos literais: `31/01 → 28/02`, `31/01/2028 → 29/02`
      (bissexto), `10/10 + semanal → 17/10 00:00`, `10/10 + diario → 11/10 00:00`.

## Fora de escopo

Gravar o `prazo_fim` (issue 255, a Server Action) e o form (issue 258). A conversão do horário
local da loja para instante na escrita — ela mora na Server Action e usa `fusoLoja`, não uma
função nova. Qualquer preset além dos quatro do banco.

## Reuso esperado

- `src/lib/utils/fusoLoja.ts` (issue 222) — `partesNoFuso`; **nenhuma aritmética de fuso nova**.
- `Intl`, como já é hoje; nenhuma lib de data nova entra no `package.json`.

## Segurança

- Não há dado sensível nem valor monetário. A função é **isomórfica**: o preview do cliente a
  usa, mas a autoridade é a Server Action, que **recalcula o `fim` e descarta o que veio do
  cliente** (RN-04) — o `prazo_preset` é eco de UI, a autoridade são `prazo_inicio`/`prazo_fim`.

## Critério de aceite

- [ ] `31/01/2026 + mensal === 28/02/2026` e `31/01/2028 + mensal === 29/02/2028`;
- [ ] `10/10/2026 00:00 + semanal === 17/10/2026 00:00` (fim exclusivo, 7 dias de 24h);
- [ ] a função não lê relógio: `inicio` é parâmetro;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
