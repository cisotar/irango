import type { ReactElement } from "react";
import Link from "next/link";
import { ShoppingBag, Clock, DollarSign } from "lucide-react";

import { TabelaPedidos } from "@/components/painel/TabelaPedidos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { calcularMetricasDoDia } from "@/lib/utils/metricasPedidos";
import { paraLinhaPedido } from "@/lib/utils/paraLinhaPedido";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

/**
 * Dashboard do lojista compartilhado (issue 122). Server Component de
 * APRESENTAÇÃO — sem `'use client'` e sem nenhum I/O.
 *
 * Recebe os pedidos JÁ filtrados pelo caller (RLS no painel; loader
 * `service_role` escopado por loja no admin, issue 138/130) e deriva as
 * métricas via `calcularMetricasDoDia` e os 20 recentes internamente. Não há
 * cálculo monetário aqui: `total` já é o valor autoritativo gravado no pedido
 * (issue 012, servidor); a métrica do dia apenas soma valores persistidos.
 *
 * `basePedidos` dirige tanto o link "Ver todos" quanto o `href` de cada linha
 * da tabela (via `TabelaPedidos`). É navegação, não barreira de segurança — o
 * isolamento por loja permanece 100% no caller.
 */
export function DashboardLoja({
  pedidos,
  basePedidos = "/painel/pedidos",
}: {
  pedidos: PedidoComItens[];
  basePedidos?: string;
}): ReactElement {
  const metricas = calcularMetricasDoDia(pedidos);
  const recentes = pedidos.slice(0, 20).map(paraLinhaPedido);

  return (
    <>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardMetrica
          rotulo="Pedidos hoje"
          valor={String(metricas.pedidosHoje)}
          icone={<ShoppingBag aria-hidden className="size-5 text-blue-600" />}
        />
        <CardMetrica
          rotulo="Pendentes"
          valor={String(metricas.pendentes)}
          icone={<Clock aria-hidden className="size-5 text-amber-600" />}
        />
        <CardMetrica
          rotulo="Total do dia"
          valor={formatarMoeda(metricas.totalDoDia)}
          icone={<DollarSign aria-hidden className="size-5 text-green-600" />}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Pedidos recentes</CardTitle>
          <Link
            href={basePedidos}
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          <TabelaPedidos pedidos={recentes} basePedidos={basePedidos} />
        </CardContent>
      </Card>
    </>
  );
}

function CardMetrica({
  rotulo,
  valor,
  icone,
}: {
  rotulo: string;
  valor: string;
  icone: ReactElement;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {rotulo}
        </CardTitle>
        {icone}
      </CardHeader>
      <div className="px-6 pb-2">
        <p className="text-2xl font-bold text-foreground">{valor}</p>
      </div>
    </Card>
  );
}
