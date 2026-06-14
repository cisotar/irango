# [085] Emenda `criarPedido` + RPC `criar_pedido` — recálculo e snapshot de opcionais

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 080, 082, 083
**Spec:** specs/spec_opcionais.md

## Objetivo
Estender a Server Action `criarPedido` e a RPC `public.criar_pedido` para aceitar `opcionais[]` por item, recalcular o subtotal COM opcionais a partir dos preços do banco e persistir snapshot imutável em `itens_pedido_opcionais` na mesma transação.

## Escopo
- [ ] Nova migration de função estendendo `public.criar_pedido` para receber opcionais por item
- [ ] Recálculo autoritativo (spec §Segurança): para cada item, `subtotal_item = (produto.preco + Σ op.preco × op.quantidade) × item.quantidade`, todos os preços do banco
- [ ] RN-O3: cada `opcional_id` deve ter `opcionais.loja_id = pedido.loja_id` → senão recusa o pedido inteiro
- [ ] RN-O4: opcional só aceito se sua `categoria_opcional_id` está associada (via `categoria_produto_opcionais`) à `categoria_id` do produto do item → senão recusa
- [ ] RN-O5: filtrar `opcionais.ativo = true`; inativo/inexistente → recusa
- [ ] RN-O6: INSERT em `itens_pedido_opcionais` com `nome_snapshot`/`preco_snapshot` copiados do banco, na mesma transação dos `itens_pedido`
- [ ] Server Action repassa `opcionais` usando `schemaPayloadPedido` estendido (083) e usa `calcularTotal` estendido (082)
- [ ] Manter gates existentes (lojaAberta, assinatura, frete/desconto da emenda 071) sem regressão

## Fora de escopo
- UI de modal/carrinho/confirmação (086, 088, 089, 090).
- Override por produto individual (fora do MVP).

## Reuso esperado
- RPC `public.criar_pedido` (071, atual) — emendar a função existente, NÃO recriar; coordenar com `tipo_entrega`/`troco_para` já adicionados.
- Server Action `criarPedido` (`lib/actions/pedido.ts`) — estender.
- `lib/utils/calcularTotal.ts` estendido (082) — fonte única de cálculo.
- `schemaPayloadPedido` estendido (083).

## Segurança
- Recálculo autoritativo no servidor (seguranca.md §10): preço de opcional vem SEMPRE do banco; valor do cliente ignorado (RN-O1, RN-O2).
- Anti-cross-tenant (RN-O3) e anti-injeção de add-on de outro tipo (RN-O4) validados contra o banco antes de aceitar.
- Snapshot imutável (RN-O6): editar/remover opcional depois não altera pedidos passados.
- RPC permanece com `SET search_path` e grants restritos (schema.md §6).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde:
  - item com 2 opcionais válidos → total = `(produto + Σ op×qtd) × qtd_item` + frete − desconto;
  - `opcional_id` de OUTRA loja → pedido recusado integralmente;
  - opcional cuja categoria de opcional NÃO está associada à categoria do produto → recusado;
  - opcional `ativo=false` → recusado;
  - `preco` adulterado no payload é ignorado (servidor recalcula do banco);
  - `itens_pedido_opcionais` gravado com `nome_snapshot`/`preco_snapshot` do banco;
  - deletar o opcional depois NÃO altera o snapshot do pedido (`ON DELETE SET NULL`).
