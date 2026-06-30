import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Helper NEUTRO (sem `'use server'`) compartilhado por TODA Server Action admin
 * desta feature (specs/admin-onboarding-assistido.md). Padroniza o início de uma
 * action admin: validar `lojaId` (UUID) server-side → provar admin ANTES de
 * elevar a service_role (fail-closed, D-4) → (futuro) registrar acesso.
 *
 * Por ser neutro, pode ser importado tanto de módulos `'use server'` quanto de
 * helpers — não exporta funções marcadas como server action.
 */

// z.guid() (não z.uuid()): valida formato uuid sem exigir nibbles de versão/variante
// RFC-4122 — alinhado com frete.ts/schemaCheckout/actions.ts do projeto. Centralizado
// aqui para reuso pelas actions admin.
export const lojaIdSchema = z.guid();

type ValidacaoLojaId =
  | { ok: true; lojaId: string }
  | { ok: false };

/**
 * Valida `lojaId` recebido do cliente via `lojaIdSchema` (safeParse). Não-UUID
 * ou valores não-string → `{ ok: false }`. UUID válido → `{ ok: true, lojaId }`.
 */
export function validarLojaIdAdmin(lojaId: unknown): ValidacaoLojaId {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false };
  return { ok: true, lojaId: parsed.data };
}

type ContextoAdmin = {
  svc: ReturnType<typeof createServiceClient>;
};

/**
 * Prepara o contexto de uma action admin escopada por `lojaId`. Prova de admin
 * (`verificarAdminSaaS`) ANTES de elevar a service_role (`createServiceClient`).
 * Se a prova lança, a exceção PROPAGA (fail-closed, D-4): NUNCA captura, NUNCA
 * vira `{ ok: false }` amigável e o service client NUNCA é criado.
 */
export async function prepararContextoAdmin(
  // `_lojaId` (prefixo underscore): no contrato para o futuro escopo por loja,
  // mas hoje a amarração ao `lojaId` é responsabilidade de cada action no `eq(...)`.
  _lojaId: string,
): Promise<ContextoAdmin> {
  await verificarAdminSaaS();
  const svc = createServiceClient();
  return { svc };
}

/**
 * Invalida o cache das rotas afetadas por uma escrita admin na loja-alvo, de forma
 * CONSISTENTE em todas as actions do bloco de onboarding assistido:
 *  - lista de assinantes (`/admin/assinantes`),
 *  - hub/abas da loja-alvo (`/admin/assinantes/${lojaId}`),
 *  - vitrine pública (`/loja/[slug]`, page) — o cardápio/perfil/tema muda lá também.
 *
 * Neutro (sem `'use server'`): só encadeia `revalidatePath`, padrão "bare" do
 * projeto (sem try/catch interno — o dado já foi persistido pela action chamadora).
 */
export function revalidarLojaAdmin(lojaId: string): void {
  revalidatePath("/admin/assinantes");
  revalidatePath(`/admin/assinantes/${lojaId}`);
  revalidatePath("/loja/[slug]", "page");
}

type AcessoAdmin = {
  adminId?: string;
  lojaId: string;
  acao: string;
  entidadeId?: string;
  metadados?: Record<string, unknown>;
};

/**
 * Ponto de extensão para o log de acesso admin (spec "Auditoria / Log de Acesso").
 * Hoje é no-op best-effort: nunca lança, sempre retorna void.
 *
 * TODO(issue futura — "Auditoria / Log de Acesso"): persistir o acesso (admin,
 * loja, ação, entidade, metadados, timestamp) numa tabela de auditoria via `svc`.
 */
export function registrarAcessoAdmin(
  // Tipado como `unknown`: o no-op não usa o client. Quando a issue de log o
  // consumir, troca-se por `ReturnType<typeof createServiceClient>`.
  _svc: unknown,
  _acesso: AcessoAdmin,
): void {
  // no-op (ver TODO acima).
}
