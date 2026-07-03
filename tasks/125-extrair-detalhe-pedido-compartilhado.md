# [125] Extrair `DetalhePedido` compartilhado do inline de `painel/pedidos/[id]/page.tsx`

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** 124
**Spec:** specs/paridade-hub-admin-painel.md (rota 4, Princípio arquitetural)

## Objetivo
Transformar a UI de detalhe do pedido (hoje inline na page do painel) em UM componente compartilhado `DetalhePedido`, consumido pelo painel e (depois) pela page admin — sem cópia de markup.

## Escopo
- [ ] Criar `src/components/painel/DetalhePedido.tsx` recebendo `pedido` (com itens), `basePedidos` (link "Voltar") e `acaoStatus?` (repassado a `AcoesStatus`).
- [ ] Mover para o componente: cabeçalho + badge, cards Ações/Cliente/Entrega/Itens/totais/Pagamento, `lerEndereco`, `APARENCIA_STATUS`, `ROTULO_FORMA_PAGAMENTO`.
- [ ] `painel/pedidos/[id]/page.tsx` passa a renderizar `<DetalhePedido ... />` (nenhum markup de detalhe inline restante).

## Fora de escopo
A page admin de detalhe (140). Loader admin (130). A action admin de status (133).

## Reuso esperado
- `AcoesStatus` parametrizado por `acao` (124).
- `formatarMoeda`, shadcn `Card`/`Badge`/`Separator`.

## Segurança
- Apresentação. Exibe SNAPSHOT gravado (nome/preço/total já autoritativos); nunca recalcula. `basePedidos` só afeta navegação. PII exibida vem de leitura já escopada pelo servidor.

## Critério de aceite
- [ ] Componente compartilhado único; nenhum markup de detalhe duplicado entre painel e admin.
- [ ] Zero regressão no detalhe do lojista (mesmos cards, mesma ordem, mesmas transições).
