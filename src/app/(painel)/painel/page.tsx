import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShoppingBag, Clock, DollarSign } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  listarPedidosDoDono,
  type PedidoComItens,
} from "@/lib/supabase/queries/pedidos";
import { TabelaPedidos, type PedidoLinha } from "@/components/painel/TabelaPedidos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { calcularMetricasDoDia } from "@/lib/utils/metricasPedidos";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Dashboard do lojista (issue 048). Server Component.
 *
 * Todo o I/O usa o client AUTENTICADO — a RLS `pedidos_acesso_lojista` isola os
 * pedidos por loja (RN-02). Não há cálculo monetário aqui: `total` já é o valor
 * autoritativo gravado no pedido (issue 012, servidor). A métrica do dia apenas
 * soma valores já persistidos. Sem loja → redireciona ao onboarding.
 */
export default async function DashboardPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const pedidos = await listarPedidosDoDono(supabase);

  const metricas = calcularMetricasDoDia(pedidos);
  const recentes = pedidos.slice(0, 20).map(paraLinha);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Dashboard
      </h1>

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
            href="/painel/pedidos"
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          <TabelaPedidos pedidos={recentes} />
        </CardContent>
      </Card>
    </div>
  );
}

function paraLinha(pedido: PedidoComItens): PedidoLinha {
  return {
    id: pedido.id,
    nome_cliente: pedido.nome_cliente,
    total: pedido.total,
    status: pedido.status as StatusPedido,
    criado_em: pedido.criado_em,
  };
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
