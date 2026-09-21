# [280] `contarProdutosEscondidos` e `diagnosticarSumico` passam a raciocinar por vínculo

**crítica:** NÃO — diagnóstico para o lojista; nenhuma decisão de valor ou permissão depende dele
**Mundo:** painel
**Depende de:** [273], [279]
**Spec:** specs/vigencia-por-item-do-cardapio.md — RN-03, RN-13 (e RN-13 da spec-mãe)

## Origem

Spec §Contrato de dados: `listarProdutosEscondidos`, `contarProdutosEscondidos` e `diagnosticarSumico`
recebem vínculos. E RN-03 muda quem some da vitrine: o exclusivo de cardápio **recorrente** com agenda
de item **nunca some** — alterna entre comprável e marcado.

## Objetivo

Alinhar o diagnóstico de "produto sumido" com o motor novo, para o painel não acusar sumiço de produto
que na verdade só está fora do dia.

## Escopo

- [ ] `contarProdutosEscondidos.ts`: a contagem e o diagnóstico usam `itemAberto`/`voltaAAbrir` por vínculo
- [ ] Produto exclusivo de cardápio recorrente com dias de item marcados **não** entra como escondido
- [ ] Continuam escondidos: exclusivo de prazo fixo expirado e de cardápio desligado
- [ ] Callers do painel/admin ajustados ao tipo `VinculosPorProdutoLidos` (já renomeado em [273])

## Fora de escopo

- O aviso de interseção vazia (RN-06) — é [276], e é outra pergunta
- Qualquer mudança em `agruparPorCardapio` — [279]

## Reuso esperado

- `avaliarVigenciaDoProduto` / `voltaAAbrir` ([273]) — nenhuma segunda leitura da regra de dia
- `contarProdutosEscondidos.test.ts` já existente como base

## Segurança

- Preview de UX; nada depende do número. Nenhuma tabela nova, nenhuma escrita.

## Critério de aceite

- [ ] Teste: exclusivo de cardápio recorrente com item `{qua}` ⇒ **não** contado como escondido, em
      qualquer dia da semana
- [ ] Teste: exclusivo de prazo fixo expirado continua contado
- [ ] `npx vitest run src/lib/utils/contarProdutosEscondidos.test.ts` verde
- [ ] `npx tsc --noEmit` = 0 · `npm test` verde
