"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabelaPedidos, type PedidoLinha } from "@/components/painel/TabelaPedidos";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Listagem de pedidos com filtro por status (issue 049). Estado puramente de UI.
 * Os pedidos já chegam escopados por RLS do servidor — o filtro apenas restringe
 * a apresentação, nunca é barreira de segurança.
 */
export type PedidosClientProps = {
  pedidos: PedidoLinha[];
};

type FiltroStatus = "todos" | StatusPedido;

const FILTROS: { valor: FiltroStatus; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "confirmado", rotulo: "Confirmados" },
  { valor: "em_preparo", rotulo: "Em preparo" },
  { valor: "saiu_entrega", rotulo: "Saiu pra entrega" },
  { valor: "entregue", rotulo: "Entregues" },
  { valor: "cancelado", rotulo: "Cancelados" },
];

export function PedidosClient({ pedidos }: PedidosClientProps) {
  const [filtro, setFiltro] = useState<FiltroStatus>("todos");

  const visiveis = useMemo(
    () =>
      filtro === "todos"
        ? pedidos
        : pedidos.filter((p) => p.status === filtro),
    [pedidos, filtro],
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Pedidos
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="sr-only">Lista de pedidos</CardTitle>
          <div
            role="tablist"
            aria-label="Filtrar pedidos por status"
            className="flex flex-wrap gap-2"
          >
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                role="tab"
                aria-selected={filtro === f.valor}
                variant={filtro === f.valor ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltro(f.valor)}
              >
                {f.rotulo}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <TabelaPedidos pedidos={visiveis} />
        </CardContent>
      </Card>
    </div>
  );
}
