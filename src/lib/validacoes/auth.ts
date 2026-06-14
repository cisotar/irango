import { z } from "zod";

/**
 * Schemas de auth (issue 015). Isomórficos: o MESMO schema valida no client
 * (form) e no servidor (Server Action) — a autoridade é o servidor.
 *
 * `.strict()` é o que impede o client de injetar campos autoritativos
 * (`assinatura_status`, `consentimento_*`, `dono_id`) no payload — o servidor
 * deriva/grava todos esses (seguranca.md §10).
 */

export const schemaCadastro = z
  .object({
    email: z.email(),
    senha: z.string().min(8).max(72), // 72 = limite bcrypt do GoTrue
    aceiteTermos: z.literal(true), // ausente/false → falha (invariante LGPD)
  })
  .strict();

export const schemaLogin = z
  .object({
    email: z.email(),
    senha: z.string().min(1), // login não revela política de senha
  })
  .strict();

export type EntradaCadastro = z.infer<typeof schemaCadastro>;
export type EntradaLogin = z.infer<typeof schemaLogin>;
