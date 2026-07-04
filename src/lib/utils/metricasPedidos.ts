import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

/**
 * Métricas agregadas do dia derivadas dos pedidos já filtrados por RLS.
 * Util puro (sem I/O): recebe a lista em memória e retorna agregados. Reusável
 * pelo Dashboard do lojista e pelo Dashboard admin (issues 122/138) — extraído
 * 1:1 de `painel/page.tsx` para evitar duplicação de cálculo.
 */
export type Metricas = {
  pedidosHoje: number;
  pendentes: number;
  totalDoDia: number;
};

/**
 * Métricas do dia derivadas dos pedidos já filtrados por RLS. "Hoje" é o dia
 * corrente no fuso de São Paulo. Pedidos cancelados não somam ao faturamento;
 * `pendentes` conta a lista inteira (não só do dia).
 */
export function calcularMetricasDoDia(pedidos: PedidoComItens[]): Metricas {
  const hoje = chaveDia(new Date());
  let pedidosHoje = 0;
  let pendentes = 0;
  let totalDoDia = 0;

  for (const pedido of pedidos) {
    if (pedido.status === "pendente") {
      pendentes += 1;
    }
    if (chaveDia(new Date(pedido.criado_em)) === hoje) {
      pedidosHoje += 1;
      if (pedido.status !== "cancelado") {
        totalDoDia += pedido.total;
      }
    }
  }

  return { pedidosHoje, pendentes, totalDoDia };
}

const formatadorDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Chave AAAA-MM-DD do dia no fuso de São Paulo (compara dia corrente). */
export function chaveDia(data: Date): string {
  return formatadorDia.format(data);
}
