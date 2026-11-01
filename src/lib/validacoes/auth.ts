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

/**
 * Base da nova senha (recuperação, duas portas): regra de senha do cadastro,
 * sem refine — cada porta acrescenta campos e compõe `.strict().refine(...)`.
 */
export const schemaBaseNovaSenha = z.object({
  senha: schemaCadastro.shape.senha,
  confirmacao: z.string(),
});

export const senhasConferem = (d: { senha: string; confirmacao: string }) => d.senha === d.confirmacao;
export const ERRO_SENHAS_NAO_CONFEREM = { message: "As senhas não conferem.", path: ["confirmacao"] };

/** Porta lojista: só senha + confirmação; `next`, `user_id`, `email` recusados. */
export const schemaNovaSenha = schemaBaseNovaSenha.strict().refine(senhasConferem, ERRO_SENHAS_NAO_CONFEREM);

/** Pedido do link da porta lojista: sem `next` (o destino é fixo). */
export const schemaRecuperacaoSenha = z.object({ email: z.email() }).strict();

export type EntradaCadastro = z.infer<typeof schemaCadastro>;
export type EntradaLogin = z.infer<typeof schemaLogin>;
export type EntradaNovaSenha = z.infer<typeof schemaNovaSenha>;
export type EntradaRecuperacaoSenha = z.infer<typeof schemaRecuperacaoSenha>;
