# 183 — `schemaTaxa` não valida `cep_inicio`/`cep_fim`, zona `faixa_cep` perde a faixa ao salvar

crítica: NÃO (nenhuma loja em produção usa frete por CEP hoje — sem impacto monetário atual)

## Origem

Achado colateral do `depurar` na Fase 0 do loop de `plan/loop-frete-faixas-e-edicao-de-zona.md`
(2026-09-09), durante a investigação do #182. Fora de escopo daquele loop, registrado aqui para não
se perder.

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

## Por que não é crítica agora

Nenhuma loja em produção usa frete por CEP hoje (confirmado pelo usuário no pedido original do loop de
frete por faixas). O defeito existe mas não afeta cobrança real em nenhuma loja ativa.

## Arquivos prováveis

- `src/lib/validacoes/entrega.ts` — adicionar `cep_inicio`/`cep_fim` ao `schemaTaxa` (provavelmente
  com `.refine` condicional ao `tipo` da zona).
- `src/components/painel/FormZona.tsx` — coletar e montar os campos no payload quando `tipo ===
  "faixa_cep"`.
- Conferir o hub admin (`admin-entrega.ts`) pelo mesmo gap, se o formulário lá também cobrir CEP.
