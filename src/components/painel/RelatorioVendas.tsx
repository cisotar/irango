import type { ReactElement } from "react";
import { Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { DadosCicloVendas, FiltrosRanking, FiltrosVendas as Filtros } from "@/lib/validacoes/vendas";
import type { ResultadoRelatorioVendas } from "@/lib/vendas/carregarRelatorioVendas";
import type { ResultadoCiclo } from "@/lib/vendas/tipos";
import { CicloMensal } from "./vendas/CicloMensal";
import { FiltrosVendas } from "./vendas/FiltrosVendas";
import type { BarraVendas } from "@/lib/utils/agregarVendas";
import type { BarraGrafico, GranularidadeVendas } from "./vendas/BarrasVendas";
import { GraficoBarrasVendas } from "./vendas/GraficoBarrasVendas";
import { ItensPorCategoria } from "./vendas/ItensPorCategoria";
import { ResumoFaturamento } from "./vendas/ResumoFaturamento";

export const AVISOS_VENDAS = [
  "Este relatório cobre só as vendas feitas pelo iRango.",
  "Os valores são nominais: o iRango não registra se o pedido foi pago.",
] as const;

export const MSG_FALHA_RELATORIO = "Não foi possível carregar o relatório. Tente de novo.";

export type RelatorioVendasProps = {
  /** Rota da página (`/painel/vendas` ou `/admin/assinantes/<id>/vendas`). */
  baseVendas: string;
  filtros: Filtros;
  /** Período/ordem do ranking a preservar nos links; null no admin, que não tem ranking. */
  ranking: FiltrosRanking | null;
  avisoFiltros: boolean;
  diaInicioCiclo: number;
  relatorio: ResultadoRelatorioVendas;
  /** Action do ciclo. Obrigatória (D12): o admin nunca cai na action do lojista por omissão. */
  salvarCiclo: (payload: DadosCicloVendas) => Promise<ResultadoCiclo>;
};

/**
 * Parte financeira do relatório de vendas (issue 358), a MESMA no painel e no
 * hub admin. Só exibe: todo número já chega calculado do servidor. Os dados de
 * clientes não passam por aqui; a página do painel compõe o card deles ao lado.
 */
/** Só chave/rótulo/líquido cruzam a fronteira do client component (achado do `acelerar`). */
function paraGrafico(
  barras: Record<GranularidadeVendas, BarraVendas[]>,
): Record<GranularidadeVendas, BarraGrafico[]> {
  const enxuta = (b: BarraVendas): BarraGrafico => ({ chave: b.chave, rotulo: b.rotulo, liquido: b.liquido });
  return { diario: barras.diario.map(enxuta), semanal: barras.semanal.map(enxuta), mensal: barras.mensal.map(enxuta) };
}

export function RelatorioVendas({
  baseVendas,
  filtros,
  ranking,
  avisoFiltros,
  diaInicioCiclo,
  relatorio,
  salvarCiclo,
}: RelatorioVendasProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <ul className="flex flex-col gap-1.5">
            {AVISOS_VENDAS.map((aviso) => (
              <li key={aviso} role="note" className="flex items-start gap-2 text-sm text-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {aviso}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <FiltrosVendas
            baseVendas={baseVendas}
            filtros={filtros}
            ranking={ranking}
            avisoFiltros={avisoFiltros}
          />
        </CardContent>
      </Card>

      <CicloMensal
        diaInicioCiclo={diaInicioCiclo}
        rotuloCicloAtual={relatorio.ok ? relatorio.contexto.cicloAtual.rotulo : null}
        salvar={salvarCiclo}
      />

      {relatorio.ok ? (
        <>
          <ResumoFaturamento totais={relatorio.dados.totais} rotuloPeriodo={relatorio.contexto.rotuloPeriodo} />
          <GraficoBarrasVendas barras={paraGrafico(relatorio.dados.barras)} />
          <ItensPorCategoria categorias={relatorio.dados.categorias} />
        </>
      ) : (
        <Card>
          <CardContent>
            <p role="alert" className="py-6 text-center text-sm text-muted-foreground">
              {MSG_FALHA_RELATORIO}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
