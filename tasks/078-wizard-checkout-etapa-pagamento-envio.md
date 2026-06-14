# [078] Wizard checkout — EtapaPagamento + envio do pedido

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 071, 075, 077
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Criar `EtapaPagamento`: formas de pagamento com instrução por tipo (QR Pix, cartão/link, dinheiro+troco), dados do cliente, `ResumoValores` e envio via `criarPedido` com tratamento de erros e redirect.

## Escopo
- [ ] Criar `components/vitrine/checkout/EtapaPagamento.tsx` e `ResumoValores`
- [ ] Listar formas de pagamento ativas (carregadas no Server Component da página, reusa `lib/supabase/queries/`)
- [ ] Pix → `<Image>` do `config.pix_qr_url` + chave com "Copiar chave" (`toast` sonner)
- [ ] Cartão/link → instrução "link de pagamento via WhatsApp após confirmação"
- [ ] Dinheiro → campo "Troco para R$ ___" (opcional, numeric) → `troco_para`
- [ ] Dados do cliente: nome (obrigatório), telefone (opcional, máscara), observações (opcional); react-hook-form + zod
- [ ] `ResumoValores` (subtotal, desconto, frete, total) — PREVIEW
- [ ] Botão "Fazer pedido" com loading; envia payload sem valores monetários (069) para `criarPedido` (071)
- [ ] Tratar erros: loja fechada, item indisponível, cupom expirado (toast "pedido criado sem desconto" conforme RPC) → mensagens amigáveis
- [ ] Sucesso → redirect `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`

## Fora de escopo
- Recálculo autoritativo (071 — já feito).
- Ajuste da página de confirmação (079).

## Reuso esperado
- `criarPedido` (071), `formatarMoeda`/`calcularTotal` (libs), `schemaPayloadPedido` (069).
- react-imask, react-hook-form + zod, sonner, `next/image`, shadcn/ui `Card`/`RadioGroup`/`Button`/`Textarea`.

## Segurança
- Payload enviado contém SÓ `{ loja_id, tipo_entrega, endereco_entrega?, codigo_cupom?, forma_pagamento, troco_para?, nome_cliente, telefone_cliente?, observacoes?, itens[] }` — nenhum valor monetário (seguranca.md §10). O recálculo é autoritativo no servidor (071).

## Critério de aceite
- [ ] Cada forma de pagamento exibe a instrução correta; Pix mostra QR + copiar chave.
- [ ] "Fazer pedido" envia e mostra loading; sucesso redireciona com id+token.
- [ ] Erros de loja fechada / item indisponível exibem toast amigável.
