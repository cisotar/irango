# [037] Página de confirmação `/loja/[slug]/confirmacao`

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 026, 036
**Spec:** specs/spec_irango_mvp.md (Confirmação)

## Objetivo
Server Component que lê o pedido por `id + token` (sem login), exibe resumo e instruções de pagamento, e limpa o carrinho.

## Escopo
- [ ] Criar `src/app/(publica)/loja/[slug]/confirmacao/page.tsx`
- [ ] Ler `?pedido=<id>&token=<token>`; `buscarPedidoPorToken` (026); se null → `redirect('/loja/[slug]')`
- [ ] CardConfirmacao (id curto), ResumoSimples (itens/total/forma), InstrucoesPagamentoFinal (chave Pix etc.)
- [ ] Limpar `sessionStorage` do carrinho ao montar (client boundary)
- [ ] BotaoVoltar → `/loja/[slug]`

## Fora de escopo
Criação do pedido (014, 036).

## Reuso esperado
- `buscarPedidoPorToken` (026), `formatarMoeda` (007), `useCarrinho` (027) para limpar

## Segurança
- Leitura SÓ por id + token — sem token correto, não há acesso (seguranca.md §pedidos)
- Não há SELECT público em `pedidos`

## Critério de aceite
- [ ] (crítica) Verificação: id correto + token errado → redireciona (não vaza pedido); par correto → exibe pedido; carrinho é limpo
