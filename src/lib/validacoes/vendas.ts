import { z } from "zod";

import {
  ORDENS_RANKING,
  PERIODOS_RANKING,
  PRESETS_VENDAS,
  TIPOS_ENTREGA_FILTRO,
  type DiaLocal,
  type OrdemRanking,
  type PeriodoRanking,
  type PresetVendas,
  type TipoEntregaFiltro,
} from "@/lib/vendas/tipos";
import {
  TETO_DIAS_PERSONALIZADO,
  diasInclusivos,
  ehDiaLocalValido,
} from "@/lib/utils/periodoVendas";

/**
 * Validações do relatório de vendas (issues 354 e 357).
 * Plano: plan/tecnico-relatorio-vendas.md §7.5.
 *
 * - Ciclo mensal: o MESMO schema roda no `CicloMensal` (UX) e nas duas Server
 *   Actions (lojista e admin); o CHECK `lojas_dia_inicio_ciclo_check` é a
 *   última linha.
 * - Filtros da URL: `lerParamsVendas` nunca lança. Cada grupo inválido cai no
 *   seu padrão e liga um aviso; a página nunca consulta sem faixa.
 */

// ── Ciclo mensal (354, RN-V08) ──────────────────────────────────────────────

export const schemaDiaInicioCiclo = z.int().min(1).max(28);
export const schemaCicloVendas = z.object({ dia_inicio_ciclo: schemaDiaInicioCiclo }).strict();
export type DadosCicloVendas = z.infer<typeof schemaCicloVendas>;
export const MSG_CICLO_INVALIDO = "Escolha um dia entre 1 e 28.";

// ── Filtros da URL (357, RN-V09/V18) ────────────────────────────────────────

export type FiltrosVendas = {
  periodo: PresetVendas;
  de: DiaLocal | null;
  ate: DiaLocal | null;
  entrega: TipoEntregaFiltro;
  concluidos: boolean;
};
export type FiltrosRanking = { periodo: PeriodoRanking; ordem: OrdemRanking };

export const FILTROS_PADRAO: FiltrosVendas = {
  periodo: "mes",
  de: null,
  ate: null,
  entrega: "ambos",
  concluidos: false,
};
export const RANKING_PADRAO: FiltrosRanking = { periodo: "mes", ordem: "pedidos" };

/** `itens_top` do ranking chega como `jsonb`: confere a forma antes de exibir. */
export const schemaItensTop = z
  .array(z.object({ nome: z.string(), quantidade: z.int().min(1) }))
  .max(3);

const schemaPreset = z.enum(PRESETS_VENDAS);
const schemaEntrega = z.enum(TIPOS_ENTREGA_FILTRO);
const schemaPeriodoRanking = z.enum(PERIODOS_RANKING);
const schemaOrdemRanking = z.enum(ORDENS_RANKING);

type ValorParam = string | string[] | undefined;

/**
 * Lê um parâmetro contra um enum. Ausente → padrão sem aviso; presente e válido
 * → valor; qualquer outra coisa (string fora do enum, array) → padrão + aviso.
 */
function lerEnum<T extends string>(
  bruto: ValorParam,
  schema: z.ZodType<T>,
  padrao: T,
): { valor: T; invalido: boolean } {
  if (bruto === undefined) return { valor: padrao, invalido: false };
  const r = schema.safeParse(bruto);
  return r.success ? { valor: r.data, invalido: false } : { valor: padrao, invalido: true };
}

/** Faixa personalizada: dois dias válidos, `de <= ate` e no máximo 366 dias inclusivos. */
function faixaPersonalizada(de: ValorParam, ate: ValorParam): { de: DiaLocal; ate: DiaLocal } | null {
  if (typeof de !== "string" || typeof ate !== "string") return null;
  if (!ehDiaLocalValido(de) || !ehDiaLocalValido(ate)) return null;
  if (de > ate) return null;
  if (diasInclusivos(de, ate) > TETO_DIAS_PERSONALIZADO) return null;
  return { de, ate };
}

export function lerParamsVendas(sp: Record<string, ValorParam>): {
  filtros: FiltrosVendas;
  ranking: FiltrosRanking;
  avisoFiltros: boolean;
  avisoRanking: boolean;
} {
  let avisoFiltros = false;

  const preset = lerEnum(sp.periodo, schemaPreset, FILTROS_PADRAO.periodo);
  avisoFiltros ||= preset.invalido;
  let periodo = preset.valor;
  let de: DiaLocal | null = null;
  let ate: DiaLocal | null = null;
  if (periodo === "personalizado") {
    const faixa = faixaPersonalizada(sp.de, sp.ate);
    if (faixa == null) {
      periodo = FILTROS_PADRAO.periodo;
      avisoFiltros = true;
    } else {
      ({ de, ate } = faixa);
    }
  }

  const entrega = lerEnum(sp.entrega, schemaEntrega, FILTROS_PADRAO.entrega);
  avisoFiltros ||= entrega.invalido;

  let concluidos = false;
  if (sp.concluidos !== undefined) {
    if (sp.concluidos === "1") concluidos = true;
    else avisoFiltros = true;
  }

  const periodoRanking = lerEnum(sp.ranking, schemaPeriodoRanking, RANKING_PADRAO.periodo);
  const ordem = lerEnum(sp.ordem, schemaOrdemRanking, RANKING_PADRAO.ordem);

  return {
    filtros: { periodo, de, ate, entrega: entrega.valor, concluidos },
    ranking: { periodo: periodoRanking.valor, ordem: ordem.valor },
    avisoFiltros,
    avisoRanking: periodoRanking.invalido || ordem.invalido,
  };
}

/**
 * Href do relatório com os filtros dados. Omite valores padrão e escreve na
 * ordem `periodo, de, ate, entrega, concluidos, ranking, ordem`. `ranking`
 * null (admin) não escreve parâmetro de ranking. Sem parâmetro → `base`.
 */
export function hrefVendas(base: string, filtros: FiltrosVendas, ranking: FiltrosRanking | null): string {
  const q = new URLSearchParams();
  if (filtros.periodo !== FILTROS_PADRAO.periodo) q.set("periodo", filtros.periodo);
  if (filtros.periodo === "personalizado" && filtros.de != null && filtros.ate != null) {
    q.set("de", filtros.de);
    q.set("ate", filtros.ate);
  }
  if (filtros.entrega !== FILTROS_PADRAO.entrega) q.set("entrega", filtros.entrega);
  if (filtros.concluidos) q.set("concluidos", "1");
  if (ranking != null) {
    if (ranking.periodo !== RANKING_PADRAO.periodo) q.set("ranking", ranking.periodo);
    if (ranking.ordem !== RANKING_PADRAO.ordem) q.set("ordem", ranking.ordem);
  }
  const qs = q.toString();
  return qs === "" ? base : `${base}?${qs}`;
}
