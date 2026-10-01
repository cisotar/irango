# 333 — `rotuloFusoLoja` exibe `UTC (GMT)` em vez de `UTC (GMT+0)` conforme o ICU do Node

**crítica:** NÃO
**Mundo:** painel
**Depende de:** —
**Spec:** —

## Origem

Encontrado ao rodar a suíte inteira durante a issue 332: `src/lib/utils/fusoLoja.test.ts:135-140`
(`rotuloFusoLoja > nomeia o fuso E o deslocamento`) falha com `expected 'UTC (GMT)' to be 'UTC (GMT+0)'`.
Falha também no `main` limpo, sem relação com a 332.

## Problema

`rotuloFusoLoja` (`src/lib/utils/fusoLoja.ts:215-221`) usa `Intl.DateTimeFormat` com
`timeZoneName: "shortOffset"` e copia o texto do ICU. Para deslocamento zero, o ICU do Node 22.22.0 devolve
`GMT` (sem `+0`); outros runtimes devolvem `GMT+0`. O rótulo exibido no form de horários muda conforme o runtime,
e o teste quebra fora do ambiente onde foi escrito.

## Direção sugerida

Normalizar no próprio util: `GMT` sozinho vira `GMT+0`, para o rótulo não depender do runtime. Manter o teste
como está (ele descreve o comportamento desejado).

## Critério de aceite

- [ ] `npx vitest run src/lib/utils/fusoLoja.test.ts` verde no Node 22.
- [ ] Demais fusos (`America/Sao_Paulo (GMT-3)` etc.) sem mudança.
