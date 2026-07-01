# [088] `FormProduto`: checkbox "Oculto da vitrine"

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [085]
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Adicionar ao `FormProduto` (criar/editar) um controle "Oculto da vitrine" separado do já existente "Disponível na vitrine", enviando `oculto` no payload validado pelo `schemaProduto`.

## Escopo
- [ ] `src/components/painel/FormProduto.tsx`: novo estado + `Checkbox` "Oculto da vitrine", espelhando o padrão do checkbox "Disponível na vitrine" atual.
- [ ] Incluir `oculto` em `montarPayload` e em `ProdutoInicial` (default `false` ao criar; valor real ao editar).
- [ ] Copy clara: "Oculto" = não aparece na vitrine; distinto de "Esgotado/Disponível".

## Fora de escopo
- Server Action `alternarOculto` e schema (085).
- Botões de linha em `ProdutosClient` (089).

## Reuso esperado
- `Checkbox` do shadcn/ui já usado para "Disponível na vitrine" — mesmo componente e padrão.
- `schemaProduto` (com `oculto`, da 085) — o form só alimenta o campo.

## Segurança
- Sem valor monetário. O `oculto` é revalidado no servidor via `schemaProduto` em `criarProduto`/`atualizarProduto` (085) — o form é só entrada; `loja_id`/dono nunca vêm do form.

## Critério de aceite
- [ ] Ao criar, `oculto` default `false`; ao editar, checkbox reflete o valor do produto.
- [ ] Marcar "Oculto" e salvar persiste `oculto = true` (via action existente).
- [ ] Controles "Oculto" e "Disponível" são independentes no form (RN-1).
