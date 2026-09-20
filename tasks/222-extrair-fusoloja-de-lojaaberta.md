# [222] Extrair `partesNoFuso` e `paraMinutos` para `lib/utils/fusoLoja.ts`

**crítica:** NÃO
**Mundo:** infra
**Depende de:** —
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1 · RN-03, RN-16

## Objetivo

Tirar a aritmética de fuso de dentro de `lojaAberta.ts` e pô-la num módulo próprio, para
que a escrita do prazo da promoção (RN-03) e o "dia de hoje na loja" do modal (RN-16)
usem **o mesmo** primitivo, em vez de uma segunda cópia. Extração sem mudança de
comportamento — `safe-refactor`, não feature.

## Escopo

- [ ] criar `src/lib/utils/fusoLoja.ts` exportando `partesNoFuso` e `paraMinutos`
      (as duas hoje privadas em `src/lib/utils/lojaAberta.ts`);
- [ ] `lojaAberta.ts` passa a **importar** as duas — nunca manter uma segunda cópia;
- [ ] teste próprio do módulo novo, ao lado dele (`fusoLoja.test.ts`), cobrindo
      instante → partes no fuso e `"HH:MM"` → minutos.

## Fora de escopo

Qualquer mudança de comportamento de `lojaAberta`. Qualquer campo novo no retorno de
`partesNoFuso` — o acréscimo de `diaDoMes` é trabalho do Spec B, e esta issue só precisa
**não impedir**, o que é exatamente o motivo de o módulo nascer separado e não como export
solto. Nenhuma aritmética de fuso escrita à mão: usa-se `Intl`, como já é hoje.

## Reuso esperado

- `src/lib/utils/lojaAberta.ts` — origem do código; ele vira importador, não some.
- `lojaAberta.test.ts` — a suíte é a régua da extração.

## Segurança

Nada sensível: não é valor monetário, não é permissão, não toca banco. O risco é de
**regressão silenciosa** no horário de funcionamento da loja, e a trava contra isso é a
suíte existente passar intocada.

## Critério de aceite

- [ ] `src/lib/utils/lojaAberta.test.ts` passa **sem uma única edição** — se algum teste
      precisar mudar, a extração mudou comportamento e está errada;
- [ ] `grep -rn "partesNoFuso\|paraMinutos" src/` mostra **uma** definição de cada,
      em `lib/utils/fusoLoja.ts`;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
