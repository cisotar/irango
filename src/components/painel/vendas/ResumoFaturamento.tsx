import type { ReactElement } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { TotaisVendas } from "@/lib/utils/agregarVendas";

/** "1 pedido com frete a combinar, não somado" / "N pedidos com frete a combinar, não somados" (RN-V05). */
export function textoFreteACombinar(n: number): string {
  return n === 1
    ? "1 pedido com frete a combinar, não somado"
    : `${n} pedidos com frete a combinar, não somados`;
}

/**
 * Números do período. Só FORMATA: os valores vêm de `vendas_por_dia` (SQL
 * `numeric` sobre o que o checkout gravou), nunca de conta feita aqui.
 */
export function ResumoFaturamento({
  totais,
  rotuloPeriodo,
}: {
  totais: TotaisVendas;
  rotuloPeriodo: string;
}): ReactElement {
  const numeros = [
    { rotulo: "Bruto", detalhe: "soma dos produtos", valor: totais.bruto },
    { rotulo: "Descontos", detalhe: "cupons e promoções", valor: totais.descontos },
    { rotulo: "Líquido", detalhe: "bruto menos descontos", valor: totais.liquido },
    { rotulo: "Frete", detalhe: "taxas de entrega", valor: totais.frete },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base font-semibold text-foreground">Faturamento</h2>
        <p className="text-sm text-muted-foreground">
          {rotuloPeriodo} · {totais.pedidos === 1 ? "1 pedido" : `${totais.pedidos} pedidos`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {numeros.map((n) => (
            <div key={n.rotulo} className="flex flex-col gap-0.5">
              <dt className="text-sm font-medium text-foreground">
                {n.rotulo}
                <span className="block text-xs font-normal text-muted-foreground">{n.detalhe}</span>
              </dt>
              <dd className="font-heading text-lg font-semibold text-foreground">{formatarMoeda(n.valor)}</dd>
            </div>
          ))}
        </dl>
        {totais.freteACombinar > 0 && (
          <p className="text-sm text-muted-foreground">{textoFreteACombinar(totais.freteACombinar)}</p>
        )}
      </CardContent>
    </Card>
  );
}
