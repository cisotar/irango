import type { ReactElement } from "react";

import { cn } from "@/lib/utils";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { BarraVendas } from "@/lib/utils/agregarVendas";

/** Só o que a barra desenha: o resto da linha agregada não cruza para o cliente. */
export type BarraGrafico = Pick<BarraVendas, "chave" | "rotulo" | "liquido">;

/** Até este número de barras o valor fica visível embaixo de cada uma; acima, só para leitor de tela. */
const MAX_VALORES_VISIVEIS = 14;

export type GranularidadeVendas = "diario" | "semanal" | "mensal";

const ROTULO_EIXO: Record<GranularidadeVendas, string> = {
  diario: "dia",
  semanal: "semana",
  mensal: "ciclo",
};

/**
 * Barras do faturamento LÍQUIDO (D15), em CSS puro (RN-V24, sem dependência).
 * Sem hooks: renderiza igual no servidor e no cliente. Cada barra tem
 * `aria-label` com rótulo e valor e o valor também em texto (nunca só cor).
 * A barra é `bg-primary` (~17:1 contra o card branco); `bg-chart-1` não passa
 * de 3:1 e é proibido aqui. Muitas barras rolam DENTRO do card.
 */
export function BarrasVendas({
  barras,
  granularidade,
}: {
  barras: BarraGrafico[];
  granularidade: GranularidadeVendas;
}): ReactElement {
  const maior = Math.max(0, ...barras.map((b) => b.liquido));
  const valoresVisiveis = barras.length <= MAX_VALORES_VISIVEIS;

  return (
    <div className="overflow-x-auto pb-2">
      <ol
        aria-label={`Faturamento líquido por ${ROTULO_EIXO[granularidade]}`}
        className="flex min-w-max items-end gap-2"
      >
        {barras.map((b) => {
          const valor = formatarMoeda(b.liquido);
          const altura = maior > 0 ? (b.liquido / maior) * 100 : 0;
          return (
            <li
              key={b.chave}
              className={cn(
                "flex shrink-0 flex-col items-center gap-1 text-center",
                granularidade === "diario" ? "w-14" : "w-24",
              )}
            >
              <span className={cn("text-xs text-foreground", !valoresVisiveis && "sr-only")}>{valor}</span>
              <div className="flex h-40 w-full items-end">
                <div
                  role="img"
                  aria-label={`${b.rotulo}: ${valor}`}
                  className="w-full rounded-t-sm bg-primary"
                  style={{ height: `${altura}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{b.rotulo}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
