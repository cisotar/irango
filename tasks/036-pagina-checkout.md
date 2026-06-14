# [036] Página de checkout `/loja/[slug]/pedido`

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 014, 029, 035
**Spec:** specs/spec_irango_mvp.md (Checkout, RN-05, RN-09)

## Objetivo
Tela de finalização: revisão de itens, dados do cliente, endereço, zona, forma de pagamento e envio via `criarPedido`. O recálculo é do servidor — o preview é só UX.

## Escopo
- [ ] Criar `src/app/(publica)/loja/[slug]/pedido/page.tsx`
- [ ] ResumoCarrinho, FormDadosCliente, FormEnderecoEntrega (ViaCEP), SeletorZonaEntrega, SeletorFormaPagamento, InstrucoesPagamento, ResumoFinanceiro
- [ ] Submeter para `criarPedido` (014) enviando SÓ `{ loja_id, itens(produto_id+quantidade), endereco, forma_pagamento, codigo_cupom, nome, telefone, observacoes }`
- [ ] Sucesso → `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`
- [ ] Tratar erro de loja fechada / item indisponível / cupom inválido com mensagem amigável
- [ ] Botão desabilitado se loja fechada (preview)

## Fora de escopo
Recálculo (já em 014). Confirmação (037).

## Reuso esperado
- `criarPedido` (014), FormEndereco/ViaCEP e seletores (029), `formatarMoeda` (007), react-hook-form + zod (022)

## Segurança
- Cliente envia apenas produto_id/quantidade/endereço/cupom — nunca valores monetários (seguranca.md §10)
- Loja fechada bloqueada no servidor (RN-09), não só no botão

## Critério de aceite
- [ ] (crítica) Verificação: editar o payload no DevTools para `total: 0.01` NÃO altera o total salvo (servidor recalcula); pedido em loja fechada é recusado; sucesso redireciona com id+token
