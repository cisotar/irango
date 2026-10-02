import Link from "next/link";
import { Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BadgeStatusPedido } from "@/components/painel/BadgeStatusPedido";
import { MenuStatusPedido } from "@/components/painel/MenuStatusPedido";
import { ProvedorRefreshCoalescido } from "@/components/painel/ProvedorRefreshCoalescido";
import type { AcaoStatus } from "@/lib/actions/status";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import { ROTULO_TIPO_ENTREGA } from "@/lib/utils/rotulosPedido";
import { ehStatusTerminal, type StatusPedido } from "@/lib/utils/transicaoStatus";

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
  /** `'retirada'` ganha o selo RETIRADA na linha (spec modalidades-entrega-loja). */
  tipo_entrega: string;
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
  /**
   * Server Action de mudança de status repassada ao selo clicável. Default = a
   * do lojista; o hub admin injeta `atualizarStatusPedidoAdmin.bind(null, lojaId)`.
   * Injeção de dependência de UI — a autoridade é a action.
   */
  acaoStatus?: AcaoStatus;
  /**
   * Issue 347 (D1/D2): o detalhe do cliente reusa a tabela só para leitura.
   * `somenteLeitura` = status sempre via `BadgeStatusPedido` (sem menu);
   * `exibirCliente={false}` oculta a coluna/linha do nome; `exibirData` troca
   * "Hora" por data + hora. Defaults preservam `/painel/pedidos` exatamente.
   */
  somenteLeitura?: boolean;
  exibirCliente?: boolean;
  exibirData?: boolean;
};

const formatadorHora = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function horaLocal(criadoEm: string): string {
  return formatadorHora.format(new Date(criadoEm));
}

/**
 * Célula de status: selo clicável (menu de ações) nos status não terminais,
 * selo estático em `entregue`/`cancelado` — a mesma `ehStatusTerminal` que o
 * servidor usa.
 */
function StatusDaLinha({
  pedido,
  acaoStatus,
  somenteLeitura = false,
}: {
  pedido: PedidoLinha;
  acaoStatus?: AcaoStatus;
  somenteLeitura?: boolean;
}) {
  if (somenteLeitura || ehStatusTerminal(pedido.status)) {
    return <BadgeStatusPedido status={pedido.status} tipoEntrega={pedido.tipo_entrega} />;
  }
  return (
    <MenuStatusPedido
      pedidoId={pedido.id}
      status={pedido.status}
      tipoEntrega={pedido.tipo_entrega}
      acao={acaoStatus}
    />
  );
}

/** Selo RETIRADA — só pedido de retirada; entrega não ganha selo nenhum. */
function SeloRetirada({ tipoEntrega }: { tipoEntrega: string }) {
  if (tipoEntrega !== "retirada") return null;
  return (
    <Badge variant="outline" className="font-semibold uppercase">
      <Store aria-hidden className="size-3.5" />
      {ROTULO_TIPO_ENTREGA.retirada}
    </Badge>
  );
}

/**
 * Tabela de pedidos reutilizável (dashboard + gestão). Linha inteira navega ao
 * detalhe. Desktop = tabela densa; mobile = lista de cards (sem scroll
 * horizontal — design-system §9). Mesma fonte de dados alimenta as duas.
 *
 * Sem `'use client'`: a interatividade do selo é uma ilha client
 * (`MenuStatusPedido`). Nos dois breakpoints o link do pedido cobre a
 * linha/cartão por sobreposição (`after:absolute after:inset-0`) e o selo fica
 * acima dela (`relative z-10`) — nenhum `<button>` dentro de `<a>`. Todas as
 * linhas compartilham um refresh coalescido (uma rajada = um refresh).
 */
export function TabelaPedidos({
  pedidos,
  basePedidos = "/painel/pedidos",
  acaoStatus,
  somenteLeitura = false,
  exibirCliente = true,
  exibirData = false,
}: TabelaPedidosProps) {
  const quando = exibirData ? formatarDataHora : horaLocal;
  if (pedidos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-12 text-center">
        <p className="text-sm text-muted-foreground">Nenhum pedido ainda</p>
      </div>
    );
  }

  return (
    <ProvedorRefreshCoalescido>
      {/* Desktop: tabela densa (já dentro de um Card — sem borda própria) */}
      <div className="hidden overflow-hidden rounded-lg md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Pedido</th>
              {exibirCliente && <th className="px-4 py-2 font-medium">Cliente</th>}
              <th className="px-4 py-2 font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">{exibirData ? "Data" : "Hora"}</th>
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
                {exibirCliente && (
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      {pedido.nome_cliente}
                      <SeloRetirada tipoEntrega={pedido.tipo_entrega} />
                    </span>
                  </td>
                )}
                <td className="px-4 py-3">
                  {exibirCliente ? (
                    formatarMoeda(pedido.total)
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      {formatarMoeda(pedido.total)}
                      <SeloRetirada tipoEntrega={pedido.tipo_entrega} />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusDaLinha pedido={pedido} acaoStatus={acaoStatus} somenteLeitura={somenteLeitura} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {quando(pedido.criado_em)}
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
            <Card size="sm" className="relative gap-2 transition-colors hover:bg-muted/50">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`${basePedidos}/${pedido.id}`}
                  className="font-mono text-sm text-foreground after:absolute after:inset-0"
                >
                  #{formatarNumeroPedido(pedido.id)}
                </Link>
                <StatusDaLinha pedido={pedido} acaoStatus={acaoStatus} somenteLeitura={somenteLeitura} />
              </div>
              {(exibirCliente || pedido.tipo_entrega === "retirada") && (
                <div className="flex flex-wrap items-center gap-2">
                  {exibirCliente && <p className="font-medium">{pedido.nome_cliente}</p>}
                  <SeloRetirada tipoEntrega={pedido.tipo_entrega} />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {formatarMoeda(pedido.total)} · {quando(pedido.criado_em)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </ProvedorRefreshCoalescido>
  );
}
