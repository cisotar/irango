# [043] Componentes TabelaProdutos e FormProduto

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 007, 010, 020
**Spec:** specs/spec_irango_mvp.md (Produtos)

## Objetivo
Componentes de listagem e formulário de produto (com upload de foto e seleção de categoria).

## Escopo
- [ ] Criar `src/components/painel/TabelaProdutos.tsx` (miniatura, nome, categoria, preço, badge disponível, ações)
- [ ] Criar `src/components/painel/FormProduto.tsx` (react-hook-form + `schemaProduto` 020; campos nome, descrição, preço, categoria select, foto, disponível, ordem)
- [ ] Validar foto no client via `validarImagem` (010) antes do upload
- [ ] DialogConfirmacaoRemocao (shadcn `AlertDialog`)

## Fora de escopo
Server Actions (031), upload server-side (018), página (044).

## Reuso esperado
- `schemaProduto` (020), `validarImagem` (010), `formatarMoeda` (007), shadcn/ui `Table`/`Form`/`Input`/`Switch`/`AlertDialog`

## Segurança
- Validação de foto no client é UX; a autoritativa é no servidor (018)

## Critério de aceite
- [ ] Form valida campos; tabela lista produtos; remoção pede confirmação
