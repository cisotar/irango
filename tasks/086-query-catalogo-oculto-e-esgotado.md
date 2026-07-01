# [086] `buscarCatalogoPublico`: filtrar `oculto = false` e deixar esgotado aparecer

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [084]
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Ajustar `buscarCatalogoPublico` para filtrar explicitamente `.eq("oculto", false)` (defesa em profundidade sobre a RLS) e parar de filtrar `disponivel = true`, de modo que produtos não-ocultos indisponíveis passem a aparecer na vitrine como esgotado (RN-3, RN-4).

## Escopo
- [ ] `src/lib/supabase/queries/produtos.ts`: em `buscarCatalogoPublico`, trocar `.eq("disponivel", true)` por `.eq("oculto", false)`.
- [ ] Garantir que o `select` traz `disponivel` de cada produto (a vitrine precisa dele para renderizar "esgotado").
- [ ] Atualizar o comentário-cabeçalho da query (hoje diz `disponivel=true AND loja_esta_ativa`) para refletir `oculto=false`.

## Fora de escopo
- Apresentação do esgotado na vitrine (`CardProduto` já suporta `disponivel={false}`; propagação é verificação de UI, não muda nesta issue salvo se faltar propagar).
- Recusa autoritativa no pedido (087).

## Reuso esperado
- `src/lib/supabase/queries/produtos.ts` — editar a query existente; `buscarProdutosPorIds` já traz `oculto` via `select("*")` e NÃO deve passar a filtrar (o recálculo precisa enxergar oculto/indisponível para recusá-lo).

## Segurança
- Defesa em profundidade: o filtro `oculto = false` na query NÃO substitui a RLS da 083 — é a segunda camada (`architecture.md §9.4`, `seguranca.md §1`). Ambas devem existir.
- Não confiar no cliente: a query é Server Component/anon key sob RLS.

## Critério de aceite
- [ ] Teste RED: `buscarCatalogoPublico` NÃO retorna produto `oculto = true`; RETORNA produto `oculto = false, disponivel = false` (com `disponivel` no objeto); RETORNA produto disponível normal.
- [ ] Comentário da query atualizado para `oculto = false`.
- [ ] `buscarProdutosPorIds` segue sem filtrar `oculto`/`disponivel`.
