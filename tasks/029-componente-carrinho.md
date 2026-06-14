# [029] Componente Carrinho (drawer) + FormEndereco com ViaCEP

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 007, 013, 027
**Spec:** specs/spec_irango_mvp.md (Vitrine)

## Objetivo
Drawer/sidebar do carrinho com itens, cupom, seleção de bairro/zona, preview de frete/desconto/total e botão "Finalizar pedido". Inclui FormEndereco com autocomplete ViaCEP.

## Escopo
- [ ] Criar `src/components/vitrine/Carrinho.tsx` (itens, +/-, subtotal, campo cupom, seleção de zona, preview frete/desconto/total, total, botão checkout)
- [ ] Aplicar cupom chamando `validarCupom` (013) — exibir veredito (preview)
- [ ] Frete e total exibidos via `calcularFrete`/`calcularTotal` (preview)
- [ ] Criar `FormEndereco` com máscara CEP (react-imask) + autocomplete ViaCEP (rua/bairro/cidade)
- [ ] Botão "Finalizar pedido" → `/loja/[slug]/pedido` (estado via `sessionStorage`)

## Fora de escopo
Recálculo autoritativo no checkout (014). Criação de pedido (036).

## Reuso esperado
- `useCarrinho` (027), `validarCupom` (013), `calcularFrete`/`calcularDesconto`/`calcularTotal` (008/009/012), `formatarMoeda` (007), shadcn/ui `Sheet`/`Drawer`/`Input`/`Button`, react-imask, ViaCEP

## Segurança
- Tudo aqui é PREVIEW; valor real só no servidor (seguranca.md §10)
- ViaCEP é API pública sem key — pode chamar do client (seguranca.md §9)

## Critério de aceite
- [ ] Adicionar/alterar/remover item atualiza subtotal
- [ ] CEP válido autopreenche endereço; cupom aplicado mostra desconto de preview
- [ ] "Finalizar pedido" navega ao checkout preservando o carrinho
