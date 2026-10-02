import { z } from "zod";
import { schemaCadastro } from "@/lib/validacoes/auth";
import { schemaEnderecoCheckout } from "@/lib/validacoes/checkout";

/**
 * Schemas da porta cliente (issues 336/337, specs/cliente-identidade.md).
 * Isomórficos: o MESMO schema valida o form e a Server Action; a autoridade é
 * o servidor. Todos `.strict()`: `id`, `cliente_id`, `papel`, `loja_id`,
 * `consentimento_*`, `criado_em`, `ultimo_acesso_em` e versão de termos nunca
 * entram pelo payload (seguranca.md §10). O banco repete as regras (CHECKs e
 * trigger de idade da migration 20261002120000_clientes.sql).
 */

export const MENSAGEM_IDADE_MINIMA = "Você precisa ter 18 anos ou mais para criar uma conta.";

/** Teto de endereços por cliente (o trigger do banco é a barreira real). */
export const MAX_ENDERECOS = 3;

const IDADE_MINIMA = 18;
const IDADE_MAXIMA = 120;

/** `next` opcional (RN-21): só transporte; o servidor sempre aplica `sanitizarNext`. */
const campoNext = z.string().max(2048).optional();

/** Regra de senha do cadastro do lojista (8–72, limite bcrypt do GoTrue) — reuso. */
const campoSenha = schemaCadastro.shape.senha;

// ── auth ──────────────────────────────────────────────────────────────────────

/** RN-06: cadastro só com e-mail e senha; aceite de termos só em /conta/completar. */
export const schemaCadastroCliente = z
  .object({ email: z.email(), senha: campoSenha, next: campoNext })
  .strict();

export const schemaEntrarCliente = z
  .object({
    email: z.email(),
    senha: z.string().min(1), // login não revela política de senha
    next: campoNext,
  })
  .strict();

export const schemaRecuperacaoCliente = z.object({ email: z.email(), next: campoNext }).strict();

/** Reenvio do link de confirmação (D4): mesmo formato da recuperação. */
export const schemaReenvioConfirmacaoCliente = schemaRecuperacaoCliente;

export const schemaNovaSenhaCliente = z
  .object({ senha: campoSenha, confirmacao: z.string(), next: campoNext })
  .strict()
  .refine((d) => d.senha === d.confirmacao, {
    message: "As senhas não conferem.",
    path: ["confirmacao"],
  });

// ── perfil ────────────────────────────────────────────────────────────────────

/** "AAAA-MM-DD" do calendário UTC, alinhado ao `current_date` do banco. */
function diaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function deslocarAnos(dia: string, anos: number): string {
  const ano = Number(dia.slice(0, 4)) - anos;
  return `${String(ano).padStart(4, "0")}${dia.slice(4)}`;
}

/** Data de calendário real (rejeita 2007-02-30). */
function ehDataValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && diaIso(d) === valor;
}

/**
 * Decisão 17: nascimento não futuro, 18+ e no máximo 120 anos, relativo a
 * `hoje` (injetável para teste; padrão = relógio do servidor). Devolve a
 * mensagem do erro, ou `null` se válida.
 */
export function validarDataNascimento(valor: string, hoje: Date = new Date()): string | null {
  if (!ehDataValida(valor)) return "Data de nascimento inválida.";
  const dia = diaIso(hoje);
  if (valor > dia) return "Data de nascimento não pode ser futura.";
  if (valor > deslocarAnos(dia, IDADE_MINIMA)) return MENSAGEM_IDADE_MINIMA;
  if (valor < deslocarAnos(dia, IDADE_MAXIMA)) return "Data de nascimento inválida.";
  return null;
}

const campoDataNascimento = z.string().superRefine((valor, ctx) => {
  const erro = validarDataNascimento(valor);
  if (erro) ctx.addIssue({ code: "custom", message: erro });
});

const camposPerfil = {
  nome: z.string().trim().min(1).max(120),
  // Mesma regex de telefone de `schemaPayloadPedido` (pedido.ts) e do CHECK do banco.
  telefone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{8,20}$/),
  data_nascimento: campoDataNascimento,
  aceita_marketing: z.boolean().default(false),
};

export const schemaPerfilCliente = z.object(camposPerfil).strict();

// ── endereço ──────────────────────────────────────────────────────────────────

/**
 * `schemaEnderecoCheckout` estendido com o rótulo e os limites dos CHECKs de
 * `clientes_enderecos` (`.extend` preserva o `.strict()`).
 */
export const schemaEnderecoCliente = schemaEnderecoCheckout.extend({
  rotulo: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[^\n\r]*$/),
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/),
  rua: z.string().trim().min(1).max(200),
  numero: z.string().trim().min(1).max(20),
  bairro: z.string().trim().min(1).max(100),
  cidade: z.string().trim().min(1).max(100),
  complemento: z.string().trim().max(100).optional(),
});

/** Decisão 19: aceite literal `true`; versão dos termos é do servidor. */
export const schemaCompletarPerfil = z
  .object({
    ...camposPerfil,
    aceiteTermos: z.literal(true),
    endereco: schemaEnderecoCliente,
    next: campoNext,
  })
  .strict();

export type EntradaCadastroCliente = z.infer<typeof schemaCadastroCliente>;
export type EntradaEntrarCliente = z.infer<typeof schemaEntrarCliente>;
export type EntradaRecuperacaoCliente = z.infer<typeof schemaRecuperacaoCliente>;
export type EntradaNovaSenhaCliente = z.infer<typeof schemaNovaSenhaCliente>;
export type EntradaPerfilCliente = z.infer<typeof schemaPerfilCliente>;
export type EntradaEnderecoCliente = z.infer<typeof schemaEnderecoCliente>;
export type EntradaCompletarPerfil = z.infer<typeof schemaCompletarPerfil>;

// ── payloads das actions de endereço / conta (issue 337) ─────────────────────

/** Criar (sem `id`) ou editar (com `id`); `cliente_id` nunca entra. */
export const schemaSalvarEnderecoCliente = schemaEnderecoCliente.extend({ id: z.guid().optional() });

/** Marcar padrão / remover: só o id do endereço; a posse vem da sessão + RLS. */
export const schemaIdEnderecoCliente = z.object({ id: z.guid() }).strict();

/**
 * Exclusão (D8): só a confirmação digitada, exata e em maiúsculas — o alvo é
 * sempre `auth.uid()` da sessão, nunca um id do payload.
 */
export const schemaExcluirConta = z.object({ confirmacao: z.literal("EXCLUIR") }).strict();

export const schemaSairCliente = z.object({ next: campoNext }).strict();

export type EntradaSalvarEnderecoCliente = z.infer<typeof schemaSalvarEnderecoCliente>;
