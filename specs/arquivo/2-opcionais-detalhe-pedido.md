Feature: corrigir src/components/painel/DetalhePedido.tsx (usado em
/painel/pedidos/[id] e espelhado em admin/assinantes/[lojaId]/pedidos/[id]).
Hoje a lista de itens (linhas ~146-164) mostra só quantidade × nome do
produto e preço — NÃO itera itens_pedido_opcionais, então adicionais/opções
escolhidas pelo cliente (com preço) somem no dashboard do lojista.

A query já traz tudo: SELECT_PEDIDO_COM_ITENS em
src/lib/supabase/queries/pedidos.ts:21 já faz
"*, itens_pedido(*, itens_pedido_opcionais(*))" — é gap de renderização,
não de dado/schema.

Nota: cupom JÁ é exibido (DetalhePedido.tsx:173-178, "Desconto (CÓDIGO)").
Confirmar com quem reportou o bug se o problema de cupom é em outro lugar
(ex. TabelaPedidos.tsx / listagem) antes de assumir retrabalho ali.

Componente de referência já pronto e testado no fluxo do cliente:
src/components/vitrine/ListaOpcionaisItem.tsx — recebe
{id, nome, preco, quantidade}[], renderiza lista compacta. Decidir:
reaproveitar diretamente (mover/expor fora de vitrine/) ou duplicar em
painel/ pra manter bounded contexts separados.

Definir na spec: layout exato dos opcionais por item (indentado sob o
produto?), como somar no subtotal exibido, tratamento quando item não tem
opcionais.
