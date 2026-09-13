# 183 — `schemaTaxa` não valida `cep_inicio`/`cep_fim`, zona `faixa_cep` perde a faixa ao salvar

crítica: SIM (feature de valor de entrega inteira morta ponta a ponta — exige TDD red-first)

## Origem

Achado colateral do `depurar` na Fase 0 do loop de `plan/loop-frete-faixas-e-edicao-de-zona.md`
(2026-09-09), durante a investigação do #182. Fora de escopo daquele loop, registrado aqui para não
se perder. Reclassificado em 2026-09-13 (commit `c008935`, `main`): revisão via `/orquestrar` +
agente `Explore` confirmou todas as afirmações A1-A6 contra o código atual, sem mudança de
diagnóstico. A classificação original (`crítica: NÃO`) confundia exposição atual ("nenhuma loja usa
CEP hoje") com gravidade do defeito (zona `faixa_cep` nunca atende nenhum cliente, em qualquer
loja, incluindo hub admin — `src/app/admin/assinantes/actions/admin-entrega.ts` reusa o mesmo
`schemaTaxa`). Ausência de uso hoje não muda o fato de que o mandato 3 (TDD red-first em código
crítico) se aplica: a correção toca a camada que decide se um endereço paga frete.

## Problema

- `src/lib/validacoes/entrega.ts:17-25` — `schemaTaxa` só declara `taxa`, `pedido_minimo_gratis`,
  `raio_max_km`. Sem `cep_inicio`/`cep_fim`. Como é `z.object` (strip por padrão), qualquer CEP
  enviado no payload é descartado silenciosamente pela validação.
- `src/components/painel/FormZona.tsx:103-115` — `montarPayload()` nem monta `cep_inicio`/`cep_fim`;
  o form não coleta esses campos.
- Consequência: as colunas gravam `NULL`, e `src/lib/utils/calcularFrete.ts:88`
  (`if (cep_inicio == null || cep_fim == null) return false;`) faz **toda** zona `faixa_cep` nunca
  atender nenhum cliente.
- A migration `20260615011000_taxas_faixa_cep.sql` adicionou as colunas e o CHECK de coerência no
  banco, mas a camada de aplicação (validação zod + formulário) nunca foi ligada a elas.

## Por que crítica (revisado)

Nenhuma loja em produção usa frete por CEP hoje (confirmado pelo usuário no pedido original do loop
de frete por faixas), então não há impacto monetário retroativo a corrigir. Mas a feature está
inteiramente morta — não é um edge case, é um caminho de valor que nunca funcionou desde a migration
`20260615011000`. Qualquer loja que ligue `faixa_cep` hoje é enganada silenciosamente (a UI deixa
cadastrar, o preview nunca cobra). Mandato 3 do projeto (TDD red-first para código que decide valor
monetário) se aplica ao fix.

## Arquivos prováveis

- `src/lib/validacoes/entrega.ts` — adicionar `cep_inicio`/`cep_fim` ao `schemaTaxa` (provavelmente
  com `.refine` condicional ao `tipo` da zona).
- `src/components/painel/FormZona.tsx` — coletar e montar os campos no payload quando `tipo ===
  "faixa_cep"`.
- Conferir o hub admin (`admin-entrega.ts`) pelo mesmo gap, se o formulário lá também cobrir CEP.
