import Link from "next/link";
import {
  Clock,
  Check,
  ChefHat,
  Bike,
  CheckCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Pedido na forma mínima exigida pela tabela (apresentação). Os dados já vêm
 * filtrados por RLS na query (issue 026) — aqui é só apresentação, sem cálculo
 * nem valor autoritativo (esses vivem no servidor, issues 008/009/012).
 */
export type PedidoLinha = {
  id: string;
  nome_cliente: string;
  total: number;
  status: StatusPedido;
  criado_em: string;
};

type TabelaPedidosProps = {
  pedidos: PedidoLinha[];
  /**
   * Prefixo de rota para o link de cada pedido (`${basePedidos}/${id}`).
   * Contrato: passar SEM barra final (ex.: `"/painel/pedidos"`), nunca
   * `"/painel/pedidos/"` — o componente concatena a barra. Default = painel do
   * lojista; consumidores admin passam o base já resolvido (ex.:
   * `"/admin/assinantes/L1/pedidos"`). É navegação, não barreira de segurança.
   */
  basePedidos?: string;
};

/**
 * Aparência de cada status (RN-08). Cores são de SISTEMA — não do tema da loja
 * (design-system §8). Sempre cor + texto + ícone (nunca só cor — WCAG).
 */
const APARENCIA_STATUS: Record<
  StatusPedido,
  { rotulo: string; icone: LucideIcon; classes: string }
> = {
  pendente: {
    rotulo: "Pendente",
    icone: Clock,
    classes: "border-transparent bg-amber-100 text-amber-800",
  },
  confirmado: {
    rotulo: "Confirmado",
    icone: Check,
    classes: "border-transparent bg-blue-100 text-blue-800",
  },
  em_preparo: {
    rotulo: "Em preparo",
    icone: ChefHat,
    classes: "border-transparent bg-orange-100 text-orange-800",
  },
  saiu_entrega: {
    rotulo: "Saiu pra entrega",
    icone: Bike,
    classes: "border-transparent bg-cyan-100 text-cyan-800",
  },
  entregue: {
    rotulo: "Entregue",
    icone: CheckCheck,
    classes: "border-transparent bg-green-100 text-green-800",
  },
  cancelado: {
    rotulo: "Cancelado",
    icone: X,
    classes: "border-transparent bg-red-100 text-red-800",
  },
};

const formatadorHora = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function horaLocal(criadoEm: string): string {
  return formatadorHora.format(new Date(criadoEm));
}

function BadgeStatusPedido({ status }: { status: StatusPedido }) {
  const { rotulo, icone: Icone, classes } = APARENCIA_STATUS[status];
  return (
    <Badge className={classes}>
      <Icone aria-hidden className="size-3.5" />
      {rotulo}
    </Badge>
  );
}

/**
 * Tabela de pedidos reutilizável (dashboard + gestão). Linha inteira navega ao
 * detalhe. Desktop = tabela densa; mobile = lista de cards (sem scroll
 * horizontal — design-system §9). Mesma fonte de dados alimenta as duas.
 */
export function TabelaPedidos({
  pedidos,
  basePedidos = "/painel/pedidos",
}: TabelaPedidosProps) {
  if (pedidos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-12 text-center">
        <p className="text-sm text-muted-foreground">Nenhum pedido ainda</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: tabela densa (já dentro de um Card — sem borda própria) */}
      <div className="hidden overflow-hidden rounded-lg md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Pedido</th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Hora</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((pedido) => (
              <tr
                key={pedido.id}
                className="relative border-b transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`${basePedidos}/${pedido.id}`}
                    className="font-mono text-foreground after:absolute after:inset-0"
                  >
                    #{formatarNumeroPedido(pedido.id)}
                  </Link>
                </td>
                <td className="px-4 py-3">{pedido.nome_cliente}</td>
                <td className="px-4 py-3">{formatarMoeda(pedido.total)}</td>
                <td className="px-4 py-3">
                  <BadgeStatusPedido status={pedido.status} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {horaLocal(pedido.criado_em)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: lista de cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {pedidos.map((pedido) => (
          <li key={pedido.id}>
            <Link href={`${basePedidos}/${pedido.id}`} className="block">
              <Card size="sm" className="gap-2 transition-colors hover:bg-muted/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-foreground">
                    #{formatarNumeroPedido(pedido.id)}
                  </span>
                  <BadgeStatusPedido status={pedido.status} />
                </div>
                <p className="font-medium">{pedido.nome_cliente}</p>
                <p className="text-sm text-muted-foreground">
                  {formatarMoeda(pedido.total)} · {horaLocal(pedido.criado_em)}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
