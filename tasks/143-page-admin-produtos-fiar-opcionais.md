# [143] Produtos (Cardápio) admin: renomear rota + fiar opcionais reais — `/admin/assinantes/[lojaId]/produtos`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 129, 132, 135
**Spec:** specs/paridade-hub-admin-painel.md (rota 7)

## Objetivo
Renomear a rota de cardápio de `.../cardapio` para `.../produtos` (paridade de URL) e plugar os dados reais de opcionais (hoje `{}`/`[]` de propósito), injetando a associação admin.

## Escopo
- [ ] Mover `[lojaId]/cardapio/` → `[lojaId]/produtos/` (page + `CardapioAdminClient`).
- [ ] `CardapioAdminClient`: receber `opcionaisPorCategoria` e `categoriasOpcional` reais (loader 132) e passá-los ao `ProdutosClient`; injetar `salvarAssociacaoOpcionaisAdmin` (135) em `acoes.salvarAssociacaoOpcionais` (129).
- [ ] Atualizar referências do link antigo (`AbasLoja` / redirects) para o novo caminho, evitando 404 antes do shell (145).

## Fora de escopo
Shell/nav (145). Remoção de `AbasLoja` (145). Loader (132). Action (135).

## Reuso esperado
- `ProdutosClient` com `acoes.salvarAssociacaoOpcionais` (129).
- Loader de opcionais escopado (132), `salvarAssociacaoOpcionaisAdmin` (135).

## Segurança
- Leitura escopada por `lojaId`. Associação revalida posse das duas pontas na action admin (135) — a page só fia dados reais.

## Critério de aceite
- [ ] Rota responde em `/admin/assinantes/[lojaId]/produtos`; rodapé de opcionais e seletor voltam a funcionar com dados reais.
- [ ] Editar associação no cardápio chama a action admin. Nenhum markup copiado do painel — usa `ProdutosClient`. Zero regressão no painel do lojista.
