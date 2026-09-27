import { z } from "zod";

import { MSG_HORA_ORDEM, MSG_HORA_PAR, horaDoDia } from "@/lib/validacoes/cardapio";
import { TETO_LOTE } from "@/lib/validacoes/produto";

/**
 * Schemas da FREQUÊNCIA DE EXIBIÇÃO (issue 322) — um zod para os dois mundos
 * (Server Actions do lojista e do admin) e para o editor do painel.
 *
 * Spec: specs/frequencia-exibicao.md (RN-5, RN-6, RN-8).
 * Plano: plan/tecnico-frequencia-exibicao.md (C3, D2, D3, D13).
 *
 * RN-8 / D13: `dias_semana = []` significa NUNCA e é distinto de `null` (todo
 * dia). Por isso a normalização é PRÓPRIA (`normalizarDiasDaFrequencia`) e não
 * a do vínculo de cardápio, que converte `[]` em `null`. As 5 chaves são
 * OBRIGATÓRIAS (`.strict()`, sem `.optional()`): chave ausente é recusada em
 * vez de virar "sem restrição" em silêncio.
 */

/**
 * D3: com ponta inclusiva, fim = início é válido — por isso não é a frase
 * "precisa ser depois" do prazo de cardápio.
 */
export const MSG_PERIODO_ORDEM = "A data de fim não pode ser antes da de início.";

/**
 * `null → null`; `[] → []` (RN-8); deduplica e ordena; 7 dias distintos →
 * `null` (uma representação para "todo dia"). Devolve array novo.
 */
export function normalizarDiasDaFrequencia(dias: number[] | null): number[] | null {
  if (dias === null) return null;
  const unicos = [...new Set(dias)].sort((a, b) => a - b);
  return unicos.length === 7 ? null : unicos;
}

/** Sem `.min(1)`: `[]` é gravável (RN-8). */
const diasDaFrequencia = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .nullable()
  .transform(normalizarDiasDaFrequencia);

export const schemaFrequencia = z
  .object({
    dias_semana: diasDaFrequencia,
    hora_inicio: horaDoDia.nullable(),
    hora_fim: horaDoDia.nullable(),
    periodo_inicio: z.iso.date().nullable(),
    periodo_fim: z.iso.date().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Espelho dos CHECKs `*_hora_par`, `*_hora_ordem`, `*_periodo_ordem`.
    // Comparação lexicográfica basta em "HH:MM" e "YYYY-MM-DD".
    if ((v.hora_inicio === null) !== (v.hora_fim === null)) {
      ctx.addIssue({ code: "custom", message: MSG_HORA_PAR, path: ["hora_fim"] });
    } else if (v.hora_inicio !== null && v.hora_fim !== null && v.hora_fim <= v.hora_inicio) {
      ctx.addIssue({ code: "custom", message: MSG_HORA_ORDEM, path: ["hora_fim"] });
    }
    if (v.periodo_inicio !== null && v.periodo_fim !== null && v.periodo_fim < v.periodo_inicio) {
      ctx.addIssue({ code: "custom", message: MSG_PERIODO_ORDEM, path: ["periodo_fim"] });
    }
  });

/** Seleção múltipla e unitária: a MESMA frequência em N produtos. */
export const schemaAplicarFrequencia = z
  .object({
    produto_ids: z
      .array(z.guid())
      .min(1)
      .max(TETO_LOTE)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Ids repetidos na seleção",
      }),
    frequencia: schemaFrequencia,
  })
  .strict();

/** Grade produto × dia: só `dias_semana`, por linha; tudo ou nada (RN-6). */
export const schemaGradeDeDias = z
  .object({
    itens: z
      .array(
        z
          .object({
            produto_id: z.guid(),
            dias_semana: diasDaFrequencia,
          })
          .strict(),
      )
      .min(1)
      .max(TETO_LOTE)
      .refine((itens) => new Set(itens.map((i) => i.produto_id)).size === itens.length, {
        message: "Produtos repetidos na grade",
      }),
  })
  .strict();

/** Frequência de UMA categoria. `oculta` tem action própria. */
export const schemaFrequenciaCategoria = z
  .object({
    categoria_id: z.guid(),
    frequencia: schemaFrequencia,
  })
  .strict();

export type DadosFrequencia = z.output<typeof schemaFrequencia>;
export type DadosAplicarFrequencia = z.output<typeof schemaAplicarFrequencia>;
export type DadosGradeDeDias = z.output<typeof schemaGradeDeDias>;
export type DadosFrequenciaCategoria = z.output<typeof schemaFrequenciaCategoria>;
