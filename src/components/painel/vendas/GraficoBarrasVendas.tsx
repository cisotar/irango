"use client";

import { useState, type ReactElement } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BarrasVendas, type BarraGrafico, type GranularidadeVendas } from "./BarrasVendas";

const ABAS: { valor: GranularidadeVendas; rotulo: string }[] = [
  { valor: "diario", rotulo: "Diário" },
  { valor: "semanal", rotulo: "Semanal" },
  { valor: "mensal", rotulo: "Mensal" },
];

/**
 * Gráfico do faturamento líquido com abas Diário/Semanal/Mensal. As três
 * granularidades já chegam prontas do servidor; a aba é só estado local de
 * exibição e não vai à URL.
 */
export function GraficoBarrasVendas({
  barras,
}: {
  barras: Record<GranularidadeVendas, BarraGrafico[]>;
}): ReactElement {
  const [aba, setAba] = useState<GranularidadeVendas>("diario");

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold text-foreground">Faturamento líquido no período</h2>
        <ToggleGroup
          aria-label="Agrupar barras por"
          value={[aba]}
          onValueChange={(v) => {
            const proxima = ABAS.find((a) => a.valor === v[0]);
            if (proxima) setAba(proxima.valor);
          }}
          spacing={1}
        >
          {ABAS.map((a) => (
            <ToggleGroupItem key={a.valor} value={a.valor} className="h-auto min-h-[44px] px-3">
              {a.rotulo}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        <BarrasVendas barras={barras[aba]} granularidade={aba} />
      </CardContent>
    </Card>
  );
}
