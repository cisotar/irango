# [291] Alvos de toque abaixo de 44px em `GerenciarCategorias`

**crítica: NÃO** — é achado de acessibilidade, não vetor de segurança ou dinheiro. Não exige
TDD red-first, mas é fácil e vale corrigir na próxima passada pelo arquivo.

**Depende de:** nada. Débito isolado, registrado mas fora do escopo da refat de
`plan/loop-refat-linha-de-produto.md` — o usuário já rejeitou mudança não pedida, então este
arquivo não é tocado por aquele loop.

## Origem

Achado do agente `desenhar` durante o diagnóstico da edição inline de produtos (issue 290): o
padrão de UI que seria reusado tem um defeito pré-existente que não pode ser copiado sem
correção.

## O problema

`src/components/painel/GerenciarCategorias.tsx:202, 211, 239, 250` usa `size="icon-sm"` nos
botões Salvar/Cancelar do modo de edição inline. Na base de fonte 120% do projeto, isso resolve
para **33,6px** — abaixo do mínimo de **44px literal** exigido por
`references/design-system.md` §5 (`min-h-[44px] min-w-[44px]`, nunca `size="icon-sm"` nem
`min-h-11`).

## Correção proposta

Trocar `size="icon-sm"` pelas classes `min-h-[44px] min-w-[44px]` nos quatro botões, nos
mesmos moldes que `FormProduto.tsx` e `LinhaItemOpcional.tsx` já usam. Mudança puramente
visual/CSS, sem lógica — candidata a `/polir`.
