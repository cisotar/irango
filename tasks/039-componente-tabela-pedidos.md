# [039] Componente TabelaPedidos + badge de status

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 007, 017
**Spec:** specs/spec_irango_mvp.md (Dashboard, Pedidos)

## Objetivo
Tabela reutilizável de pedidos (dashboard e gestão), com badge colorido de status.

## Escopo
- [ ] Criar `src/components/painel/TabelaPedidos.tsx` (colunas: id curto, cliente, valor, status badge, data)
- [ ] Badge colorido por status (`StatusPedido` de 017)
- [ ] Linha clicável → `/painel/pedidos/[id]`

## Fora de escopo
Listagem/queries (026), atualização de status (033, 049).

## Reuso esperado
- `formatarMoeda` (007), tipos (017), shadcn/ui `Table`/`Badge`

## Segurança
- Apresentação apenas — dados já vêm filtrados por RLS.

## Critério de aceite
- [ ] Renderiza com pedidos mockados; badge muda de cor por status; linha navega ao detalhe
