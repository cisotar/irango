import type { ReactElement } from "react";

import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import {
  ROTULO_TIPO_ENTREGA,
  lerBairro,
  mapearOpcionaisExibicao,
} from "@/lib/utils/rotulosPedido";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

/**
 * Comanda da COZINHA — via de preparo (variante 2), térmica 80mm, print-only.
 *
 * Server Component PURO: SEM `'use client'`, SEM I/O e SEM recálculo. Renderiza
 * apenas o SNAPSHOT já carregado pelo caller (escopo por RLS no painel). RN-P1:
 * ZERO informação financeira — nenhum preço unitário/linha, subtotal, desconto,
 * taxa, total nem forma de pagamento. Também NÃO expõe telefone do cliente nem
 * `token_acesso`. Os opcionais vêm de `ListaOpcionaisItem` com `ocultarPreco`
 * (131), sem duplicar o markup e sem qualquer valor monetário no DOM.
 *
 * As classes `print-cozinha print-only` são só marcadores — a visibilidade
 * (`@media print`) e o dimensionamento térmico são do CSS da issue 138. O gate
 * por entitlement e a montagem condicional são da issue 135; aqui é apresentação
 * pura, sem decisão de negócio.
 */

export function ComandaCozinha({ pedido }: { pedido: PedidoComItens }): ReactElement {
  const numero = formatarNumeroPedido(pedido.id);
  const tipoEntrega = ROTULO_TIPO_ENTREGA[pedido.tipo_entrega] ?? pedido.tipo_entrega;
  // Bairro só faz sentido em entrega; retirada não tem endereço.
  const bairro =
    pedido.tipo_entrega === "entrega" ? lerBairro(pedido.endereco_entrega) : null;

  return (
    <div className="print-cozinha print-only w-auto text-black">
      <p className="text-sm font-bold uppercase">Comanda — Cozinha</p>

      {/* Nº do pedido: âncora visual na bancada — grande e peso máximo. */}
      <p className="text-2xl font-black">#{numero}</p>

      <p className="text-xs">{formatarDataHora(pedido.criado_em)}</p>

      <div className="mt-2 text-sm">
        <p className="font-bold">{pedido.nome_cliente}</p>
        <p className="uppercase">{tipoEntrega}</p>
        {bairro && <p>Bairro: {bairro}</p>}
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {pedido.itens_pedido.map((item) => {
          const opcionais = mapearOpcionaisExibicao(item.itens_pedido_opcionais ?? []);
          return (
            <li key={item.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="border border-black px-1.5 font-black">
                  {item.quantidade}×
                </span>
                <span className="font-bold uppercase">{item.nome}</span>
              </div>
              {/* `ocultarPreco`: opcionais sem valor monetário no DOM (RN-P1). */}
              <ListaOpcionaisItem opcionais={opcionais} ocultarPreco />
            </li>
          );
        })}
      </ul>

      {pedido.observacoes && (
        <div className="mt-3 border-2 border-black p-2">
          <p className="text-xs font-bold uppercase">Obs:</p>
          <p className="text-sm">{pedido.observacoes}</p>
        </div>
      )}
    </div>
  );
}
