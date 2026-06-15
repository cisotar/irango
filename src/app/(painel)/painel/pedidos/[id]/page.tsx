import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { buscarPedidoDoDono } from "@/lib/supabase/queries/pedidos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";
import { AcoesStatus } from "./AcoesStatus";

/**
 * Detalhe do pedido (issue 049). Server Component.
 *
 * Lê o pedido via client AUTENTICADO — a RLS `pedidos_acesso_lojista` garante
 * que o lojista só vê pedido da própria loja (RN-02). Pedido de outra loja ou
 * inexistente → `null` → `notFound()`. Exibe o SNAPSHOT gravado (nome/preço dos
 * itens, total) — nunca recalcula nem busca o produto atual.
 */
const ROTULO_FORMA_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  link: "Link de pagamento",
  cartao: "Cartão",
};

const APARENCIA_STATUS: Record<StatusPedido, { rotulo: string; classes: string }> = {
  pendente: { rotulo: "Pendente", classes: "bg-amber-100 text-amber-800" },
  confirmado: { rotulo: "Confirmado", classes: "bg-blue-100 text-blue-800" },
  em_preparo: { rotulo: "Em preparo", classes: "bg-orange-100 text-orange-800" },
  saiu_entrega: { rotulo: "Saiu pra entrega", classes: "bg-cyan-100 text-cyan-800" },
  entregue: { rotulo: "Entregue", classes: "bg-green-100 text-green-800" },
  cancelado: { rotulo: "Cancelado", classes: "bg-red-100 text-red-800" },
};

type EnderecoEntrega = {
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  complemento?: string;
};

/** Narrowing seguro do `Json | null` do endereço para exibição. */
function lerEndereco(valor: unknown): EnderecoEntrega | null {
  if (valor == null || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as EnderecoEntrega;
}

export default async function DetalhePedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createClient();

  const pedido = await buscarPedidoDoDono(supabase, id);
  if (pedido == null) {
    notFound();
  }

  const status = pedido.status as StatusPedido;
  const aparencia = APARENCIA_STATUS[status];
  const endereco = lerEndereco(pedido.endereco_entrega);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href="/painel/pedidos"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Voltar aos pedidos
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            Pedido #{pedido.id.slice(0, 8).toUpperCase()}
          </h1>
          {aparencia && (
            <Badge className={`border-transparent ${aparencia.classes}`}>
              {aparencia.rotulo}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ações</CardTitle>
        </CardHeader>
        <CardContent>
          <AcoesStatus pedidoId={pedido.id} statusAtual={status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="font-medium text-foreground">{pedido.nome_cliente}</p>
          {pedido.telefone_cliente && (
            <p className="text-muted-foreground">{pedido.telefone_cliente}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entrega</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          {endereco ? (
            <>
              <p>
                {endereco.rua}
                {endereco.numero ? `, ${endereco.numero}` : ""}
              </p>
              {endereco.complemento && <p>{endereco.complemento}</p>}
              <p>
                {endereco.bairro}
                {endereco.cidade ? ` — ${endereco.cidade}` : ""}
              </p>
              {endereco.cep && <p>CEP {endereco.cep}</p>}
            </>
          ) : (
            <p>Sem endereço de entrega.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Itens</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-foreground/10">
            {pedido.itens_pedido.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
              >
                <span className="text-foreground">
                  <span className="text-muted-foreground">
                    {item.quantidade}×{" "}
                  </span>
                  {item.nome}
                </span>
                <span className="text-foreground">
                  {formatarMoeda(item.preco * item.quantidade)}
                </span>
              </li>
            ))}
          </ul>

          <Separator />

          <div className="space-y-1 px-6 py-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatarMoeda(pedido.subtotal)}</span>
            </div>
            {pedido.desconto > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Desconto{pedido.cupom_codigo ? ` (${pedido.cupom_codigo})` : ""}</span>
                <span>- {formatarMoeda(pedido.desconto)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Taxa de entrega</span>
              <span>{formatarMoeda(pedido.taxa_entrega)}</span>
            </div>
            <div className="flex justify-between pt-1 text-base font-semibold text-foreground">
              <span>Total</span>
              <span>{formatarMoeda(pedido.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pagamento e observações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            Forma de pagamento:{" "}
            <span className="text-foreground">
              {pedido.forma_pagamento
                ? (ROTULO_FORMA_PAGAMENTO[pedido.forma_pagamento] ??
                  pedido.forma_pagamento)
                : "—"}
            </span>
          </p>
          {pedido.observacoes && (
            <p>
              Observações:{" "}
              <span className="text-foreground">{pedido.observacoes}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
