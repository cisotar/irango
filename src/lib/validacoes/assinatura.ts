import { z } from "zod";

/**
 * Schemas de intenção de assinatura do lojista (issue 078). Isomórficos: o MESMO
 * schema valida no client (form) e no servidor (Server Action) — a autoridade é
 * o servidor.
 *
 * `.strict()` é o que impede o client de injetar valor autoritativo
 * (`preco`/`value`/`assinatura_status`) no payload: o único campo aceito é
 * `plano_id`, e o preço cobrado vem EXCLUSIVAMENTE de `planos.preco` no banco
 * (RN-1, seguranca.md §10). Qualquer campo extra → `safeParse` falha.
 */

// z.guid() valida o FORMATO uuid sem exigir os nibbles de versão/variante
// RFC-4122 (espelha cupomUso.ts/checkout.ts) — coerente com o tipo `uuid` do PG.
export const iniciarAssinaturaSchema = z
  .object({ plano_id: z.guid() })
  .strict();

export type EntradaIniciarAssinatura = z.infer<typeof iniciarAssinaturaSchema>;

export const cancelarAssinaturaSchema = z.object({}).strict();
