import type { ReactElement } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { CategoriaVendas } from "@/lib/utils/agregarVendas";

/**
 * Itens vendidos por categoria congelada na venda (RN-V14/V16). Valor BRUTO por
 * linha, sem total geral (D7): o faturamento tem uma fonte só, o resumo. A
 * ordem e o balde "Sem categoria" por último vêm do servidor.
 */
export function ItensPorCategoria({ categorias }: { categorias: CategoriaVendas[] }): ReactElement {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base font-semibold text-foreground">Itens vendidos por categoria</h2>
        <p className="text-sm text-muted-foreground">
          Valores brutos. O desconto é do pedido e não é dividido entre os itens.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {categorias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma venda no período.</p>
        ) : (
          categorias.map((c) => (
            <section key={c.categoriaId ?? "sem-categoria"} className="flex flex-col gap-2">
              <h3 className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1 text-sm font-semibold text-foreground">
                <span>{c.nome}</span>
                <span className="font-normal text-muted-foreground">
                  {c.quantidade === 1 ? "1 unidade" : `${c.quantidade} unidades`} · {formatarMoeda(c.valorBruto)}
                </span>
              </h3>
              <ul className="flex flex-col gap-1">
                {c.itens.map((i) => (
                  <li key={i.nome} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words text-foreground">
                      {i.quantidade}× {i.nome}
                    </span>
                    <span className="shrink-0 text-foreground">{formatarMoeda(i.valorBruto)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
