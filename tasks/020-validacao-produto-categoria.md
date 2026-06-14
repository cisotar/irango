# [020] Validação zod `produto` e `categoria`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-11)

## Objetivo
Schemas zod de produto e categoria, reusados no form e na Server Action.

## Escopo
- [ ] Criar `src/lib/validacoes/produto.ts`
- [ ] `schemaProduto`: nome 1..200, descricao opcional, `preco` >= 0 (numeric 2 casas), categoria_id uuid opcional, disponivel boolean, ordem int >= 0
- [ ] `schemaCategoria`: nome 1+, ordem int >= 0
- [ ] Refinar `preco` para no máximo 2 casas decimais

## Fora de escopo
Validação de imagem (010, já existe). Server Actions (031).

## Reuso esperado
- `zod`; `validarImagem` (010) para o campo de foto
- Mesmo schema no `FormProduto` e na Server Action

## Segurança
- `preco >= 0` validado no servidor além do CHECK do banco (seguranca.md §6)

## Critério de aceite
- [ ] (crítica) Teste vermelho: `preco = -5` rejeitado; `preco = 10.999` rejeitado; nome vazio rejeitado; produto válido aceito
