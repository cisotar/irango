# [141] Extrair `formatarNumeroPedido(id)` — `id.slice(0,8).toUpperCase()` duplicado em 6 lugares

**crítica:** NÃO (DRY / débito técnico pré-existente)
**Mundo:** compartilhado (vitrine + painel)
**Origem:** revisão das issues 133/134 (nota não-bloqueante — padrão pré-existente)

## Contexto
O padrão `id.slice(0, 8).toUpperCase()` (nº curto do pedido) está repetido em ao menos
6 arquivos: `src/lib/utils/whatsappPedido.ts`, `src/app/.../confirmacao/page.tsx`,
`TabelaPedidos.tsx`, `DetalhePedido.tsx`, e agora `ComandaCozinha.tsx` + `ReciboCliente.tsx`.
As issues 133/134 apenas seguiram o padrão existente; extrair agora tocaria arquivos fora
do escopo delas, por isso virou débito.

## Escopo
- [ ] Criar `formatarNumeroPedido(id: string): string` em `src/lib/utils/` (ex.: junto de
  `rotulosPedido.ts`) — `id.slice(0,8).toUpperCase()`, com teste unitário.
- [ ] Substituir as 6 ocorrências pela função.
- [ ] Rodar suíte inteira (garantir zero regressão nos snapshots/testes que citam o nº).

## Critério de aceite
- [ ] Uma única definição do formato do nº do pedido; os 6 callers reusam.
- [ ] `next build` + `vitest run` verdes.
