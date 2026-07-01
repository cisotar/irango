# [089] `ProdutosClient`: separar controle Oculto/Exibir de Disponível/Esgotado + badge combinado

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [085], [088]
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Separar o botão único "Ocultar/Exibir" (hoje chama `alternarDisponibilidade`) em dois controles distintos por linha — visibilidade (`alternarOculto`) e disponibilidade (`alternarDisponibilidade`, sem mudar) — e refazer o badge de status para distinguir Disponível / Esgotado / Oculto (RN-6).

## Escopo
- [ ] `src/app/(painel)/painel/produtos/ProdutosClient.tsx`: o controle "Ocultar/Exibir" passa a chamar `alternarOculto` (escreve `oculto`).
- [ ] Adicionar controle "Disponível/Esgotado" que chama `alternarDisponibilidade` (escreve `disponivel`) — comportamento inalterado dessa action.
- [ ] Badge de status derivado dos dois eixos: "Oculto" / "Esgotado" / "Disponível".
- [ ] Confirmar que a variante admin (`/admin/assinantes`) que reusa `ProdutosClient` com actions injetadas continua funcionando (herda automaticamente).

## Fora de escopo
- Server Actions (085) e schema/form (088).
- Vitrine pública.

## Reuso esperado
- `alternarOculto` (085) e `alternarDisponibilidade` (existente).
- `Badge`, `Button` do shadcn — inalterados; só nova composição.

## Segurança
- Sem valor monetário. Toda escrita passa pelas Server Actions sob RLS `produtos_escrita_propria` (085); o cliente só dispara a ação por `id`, o isolamento é no servidor.

## Critério de aceite
- [ ] "Ocultar/Exibir" alterna `oculto` (produto some/volta da vitrine) e NÃO afeta `disponivel`.
- [ ] "Disponível/Esgotado" alterna `disponivel` sem ocultar.
- [ ] Badge mostra corretamente Oculto vs. Esgotado vs. Disponível para as três combinações (RN-1).
- [ ] Variante admin de `/admin/assinantes` segue operante.
