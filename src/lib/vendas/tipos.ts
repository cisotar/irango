/**
 * Tipos e constantes de domínio do relatório de vendas (issues 353–358).
 * Módulo PURO, sem I/O: queries (`lib/supabase/queries/vendas.ts`), zod
 * (`lib/validacoes/vendas.ts`) e utils de período importam daqui, então não há
 * ciclo de import. Plano: plan/tecnico-relatorio-vendas.md §7.1 (D17).
 */

export const TIPOS_ENTREGA_FILTRO = ["entrega", "retirada", "ambos"] as const;
export type TipoEntregaFiltro = (typeof TIPOS_ENTREGA_FILTRO)[number];

export const ORDENS_RANKING = ["pedidos", "total", "ultimo"] as const;
export type OrdemRanking = (typeof ORDENS_RANKING)[number];

/** Teto do ranking de clientes fiéis (RN-V19); o SQL recusa fora de 1..20. */
export const LIMITE_RANKING = 20;

export const PRESETS_VENDAS = ["hoje", "semana", "mes", "mes_anterior", "ano", "personalizado"] as const;
export type PresetVendas = (typeof PRESETS_VENDAS)[number];

export const PERIODOS_RANKING = ["semana", "mes", "ano", "tudo"] as const;
export type PeriodoRanking = (typeof PERIODOS_RANKING)[number];

/** "YYYY-MM-DD" no calendário local da loja. */
export type DiaLocal = string;

/** Intervalo de dias locais, inclusivo nas duas pontas. */
export type IntervaloDias = { deDia: DiaLocal; ateDia: DiaLocal };

export type ResultadoCiclo = { ok: true } | { ok: false; erro: string };
