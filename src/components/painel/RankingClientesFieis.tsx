import type { ReactElement } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { hrefVendas, type FiltrosRanking, type FiltrosVendas } from "@/lib/validacoes/vendas";
import type { ResultadoRanking } from "@/lib/vendas/carregarRankingClientes";
import type { OrdemRanking, PeriodoRanking } from "@/lib/vendas/tipos";

const PERIODOS: { valor: PeriodoRanking; rotulo: string }[] = [
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
  { valor: "ano", rotulo: "Ano" },
  { valor: "tudo", rotulo: "Desde o início" },
];

const ORDENS: { valor: OrdemRanking; rotulo: string }[] = [
  { valor: "pedidos", rotulo: "Mais pedidos" },
  { valor: "total", rotulo: "Maior gasto" },
  { valor: "ultimo", rotulo: "Pedido mais recente" },
];

/** "3 pedidos de convidados fora do ranking" / "1 pedido de convidado fora do ranking" (RN-V17). */
export function textoConvidados(n: number): string {
  return n === 1
    ? "1 pedido de convidado fora do ranking"
    : `${n} pedidos de convidados fora do ranking`;
}

function LinkRanking({ href, ativo, children }: { href: string; ativo: boolean; children: string }) {
  return (
    <Button
      size="sm"
      variant={ativo ? "default" : "outline"}
      className="min-h-[44px]"
      aria-current={ativo ? "true" : undefined}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  );
}

/**
 * Clientes fiéis (issue 358, RN-V17..V20). SÓ no painel do lojista. O período e
 * a ordem são parâmetros próprios da URL, independentes dos filtros globais
 * (que os links preservam). A lista chega ordenada e cortada pelo banco: aqui
 * não se reordena nada. Sem telefone e sem e-mail: só nome e métricas.
 */
export function RankingClientesFieis({
  baseVendas,
  filtros,
  ranking,
  resultado,
  timezone,
}: {
  baseVendas: string;
  filtros: FiltrosVendas;
  ranking: FiltrosRanking;
  resultado: ResultadoRanking;
  timezone: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">Clientes fiéis</h2>
          <p className="text-sm text-muted-foreground">
            Quem comprou com a conta logada{resultado.ok ? ` · ${resultado.rotuloPeriodo}` : ""}
          </p>
        </div>
        <nav aria-label="Período dos clientes fiéis" className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => (
            <LinkRanking
              key={p.valor}
              href={hrefVendas(baseVendas, filtros, { ...ranking, periodo: p.valor })}
              ativo={ranking.periodo === p.valor}
            >
              {p.rotulo}
            </LinkRanking>
          ))}
        </nav>
        <nav aria-label="Ordenar clientes fiéis" className="flex flex-wrap gap-2">
          {ORDENS.map((o) => (
            <LinkRanking
              key={o.valor}
              href={hrefVendas(baseVendas, filtros, { ...ranking, ordem: o.valor })}
              ativo={ranking.ordem === o.valor}
            >
              {o.rotulo}
            </LinkRanking>
          ))}
        </nav>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!resultado.ok ? (
          <p role="alert" className="py-6 text-center text-sm text-muted-foreground">
            Não foi possível carregar os clientes fiéis. Tente de novo.
          </p>
        ) : (
          <>
            {resultado.clientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum cliente com conta comprou no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th scope="col" className="py-2 pr-3 font-medium">Cliente</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Pedidos</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Total gasto</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Último pedido</th>
                      <th scope="col" className="py-2 font-medium">Mais comprados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.clientes.map((c) => (
                      <tr key={c.clienteId} className="border-b align-top last:border-b-0">
                        <th scope="row" className="py-2 pr-3 font-medium text-foreground">{c.nome}</th>
                        <td className="py-2 pr-3 text-right">{c.totalPedidos}</td>
                        <td className="py-2 pr-3 text-right">{formatarMoeda(c.totalGasto)}</td>
                        <td className="py-2 pr-3">{formatarDataHora(c.ultimoPedidoEm, timezone)}</td>
                        <td className="py-2">
                          {c.itensTop.length === 0
                            ? "—"
                            : c.itensTop.map((i) => `${i.quantidade}× ${i.nome}`).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {resultado.convidados > 0 && (
              <p className="text-sm text-muted-foreground">{textoConvidados(resultado.convidados)}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
