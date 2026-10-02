"use client";

import { useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { TabelaPedidos, type PedidoLinha } from "@/components/painel/TabelaPedidos";
import { carregarMaisPedidosDoCliente } from "@/lib/actions/clientesDaLoja";

/**
 * Pedidos do cliente nesta loja (issue 347, D1–D3/D9): todos os status, só
 * leitura (status via `BadgeStatusPedido`), sem coluna Cliente, com data.
 * 50 por página; "Carregar mais" pede a próxima página ao servidor.
 */
export function PedidosDoCliente({
  clienteId,
  inicial,
  temMaisInicial,
}: {
  clienteId: string;
  inicial: PedidoLinha[];
  temMaisInicial: boolean;
}): ReactElement {
  const [pedidos, setPedidos] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const [temMais, setTemMais] = useState(temMaisInicial);
  const [pendente, iniciar] = useTransition();

  function carregar(): void {
    iniciar(async () => {
      const r = await carregarMaisPedidosDoCliente(clienteId, pagina);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      setPedidos((atuais) => [...atuais, ...r.pedidos]);
      setPagina((p) => p + 1);
      setTemMais(r.temMais);
    });
  }

  return (
    <>
      <TabelaPedidos pedidos={pedidos} somenteLeitura exibirCliente={false} exibirData />
      {temMais && (
        <Button variant="outline" className="min-h-11 self-center" onClick={carregar} disabled={pendente}>
          {pendente ? "Carregando..." : "Carregar mais"}
        </Button>
      )}
    </>
  );
}
