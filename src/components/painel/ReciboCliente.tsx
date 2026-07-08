import type { ReactElement } from "react";

import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import {
  ROTULO_FORMA_PAGAMENTO,
  ROTULO_TIPO_ENTREGA,
  lerBairro,
  mapearOpcionaisExibicao,
} from "@/lib/utils/rotulosPedido";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

/**
 * Recibo do CLIENTE — via de cortesia (variante 3), térmica 80mm, print-only e
 * NÃO-FISCAL.
 *
 * Server Component PURO: SEM `'use client'`, SEM I/O e SEM recálculo. Renderiza
 * apenas o SNAPSHOT já carregado pelo caller (escopo por RLS no painel). RN-P1:
 * financeiro COMPLETO — itens com preço, subtotal, desconto (+ cupom), taxa,
 * total e forma de pagamento/troco — todos lidos direto do snapshot, com a mesma
 * aritmética de exibição de `DetalhePedido` (nunca recalcula do produto atual).
 * NÃO expõe `token_acesso`.
 *
 * RN-P6 (compliance, não tributário): rodapé fixo "Documento sem valor fiscal —
 * comprovante de pedido." em moldura visível — este comprovante NÃO é documento
 * tributário.
 *
 * As classes `print-recibo print-only` são só marcadores — a visibilidade
 * (`@media print`) e o dimensionamento térmico são do CSS da issue 138. O gate
 * por entitlement e a montagem condicional são da issue 135; aqui é apresentação
 * pura, sem decisão de negócio.
 */

export function ReciboCliente({
  pedido,
  nomeLoja,
}: {
  pedido: PedidoComItens;
  nomeLoja: string;
}): ReactElement {
  const numero = formatarNumeroPedido(pedido.id);
  const tipoEntrega = ROTULO_TIPO_ENTREGA[pedido.tipo_entrega] ?? pedido.tipo_entrega;
  // Bairro só faz sentido em entrega; retirada não tem endereço.
  const bairro =
    pedido.tipo_entrega === "entrega" ? lerBairro(pedido.endereco_entrega) : null;
  const rotuloPagamento = pedido.forma_pagamento
    ? (ROTULO_FORMA_PAGAMENTO[pedido.forma_pagamento] ?? pedido.forma_pagamento)
    : "—";
  // Troco só quando pago em dinheiro com valor informado (> 0). Fora disso, null
  // — narrowing garante `troco_para` não-nulo no JSX.
  const troco =
    pedido.forma_pagamento === "dinheiro" &&
    pedido.troco_para != null &&
    pedido.troco_para > 0
      ? pedido.troco_para
      : null;

  return (
    <div className="print-recibo print-only w-auto text-black">
      <p className="text-center text-sm font-bold uppercase">{nomeLoja}</p>

      <div className="mt-1 text-xs">
        <p>Pedido #{numero}</p>
        <p>{formatarDataHora(pedido.criado_em)}</p>
      </div>

      <div className="mt-2 text-sm">
        <p className="font-bold">{pedido.nome_cliente}</p>
        <p className="uppercase">
          {tipoEntrega}
          {bairro ? ` — ${bairro}` : ""}
        </p>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {pedido.itens_pedido.map((item) => {
          // SNAPSHOT (RN-O6): acréscimo dos opcionais entra no total da linha —
          // mesma aritmética de exibição do DetalhePedido, nunca recalculada dos
          // opcionais atuais do produto.
          const opcionais = mapearOpcionaisExibicao(item.itens_pedido_opcionais ?? []);
          const acrescimo = opcionais.reduce((s, o) => s + o.preco * o.quantidade, 0);
          return (
            <li key={item.id} className="text-sm">
              <div className="flex justify-between gap-2">
                <span>
                  {item.quantidade}× {item.nome}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatarMoeda((item.preco + acrescimo) * item.quantidade)}
                </span>
              </div>
              {/* COM preço (comportamento default) — recibo do cliente é financeiro. */}
              <ListaOpcionaisItem opcionais={opcionais} />
            </li>
          );
        })}
      </ul>

      <div className="mt-2 border-t border-black pt-2 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="shrink-0 tabular-nums">{formatarMoeda(pedido.subtotal)}</span>
        </div>
        {pedido.desconto > 0 && (
          <div className="flex justify-between">
            <span>
              Desconto{pedido.cupom_codigo ? ` (${pedido.cupom_codigo})` : ""}
            </span>
            <span className="shrink-0 tabular-nums">
              - {formatarMoeda(pedido.desconto)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Taxa de entrega</span>
          <span className="shrink-0 tabular-nums">
            {formatarMoeda(pedido.taxa_entrega)}
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[1.2rem] font-black">
          <span>TOTAL</span>
          <span className="shrink-0 tabular-nums">{formatarMoeda(pedido.total)}</span>
        </div>
      </div>

      <div className="mt-2 text-sm">
        <p>Pagamento: {rotuloPagamento}</p>
        {troco != null && <p>Troco para {formatarMoeda(troco)}</p>}
      </div>

      {/* RN-P6: aviso não-fiscal literal, moldura visível, ≥11px, peso 600. */}
      <div className="mt-3 border-2 border-black p-2 text-center">
        <p className="text-[11px] font-semibold">
          Documento sem valor fiscal — comprovante de pedido.
        </p>
      </div>
    </div>
  );
}
