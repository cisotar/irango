import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Lê e valida `process.env.SAAS_ADMIN_USER_ID` (server-only, sem NEXT_PUBLIC_).
 * Fail-closed (D-5): ausente/vazia → lança. Sem admin configurado, NENHUMA ação
 * administrativa é liberada (inclusive para o admin real).
 */
export function obterAdminUserId(): string {
  const id = process.env.SAAS_ADMIN_USER_ID;
  if (!id) {
    console.error("[admin] SAAS_ADMIN_USER_ID não configurado");
    throw new Error("SAAS_ADMIN_USER_ID não configurado");
  }
  return id;
}

/**
 * Comparação server-only e SÍNCRONA de um `user.id` já autoritativo contra
 * `SAAS_ADMIN_USER_ID`. Ao contrário de `verificarAdminSaaS()`/`obterAdminUserId()`
 * (fail-CLOSED), este helper é fail-SAFE: env ausente/vazia → `false` (não lança),
 * para uso no callback OAuth (148) onde o login NUNCA pode quebrar por config
 * faltando. Não faz `getUser()`: o `userId` deve vir de uma sessão já verificada.
 */
export function ehAdminSaaS(userId: string): boolean {
  if (!userId) return false;
  try {
    return userId === obterAdminUserId();
  } catch {
    return false; // env ausente/vazia: login segue como não-admin.
  }
}

/**
 * Única prova de identidade do dono do SaaS (RN-13). Compara o `user.id` derivado
 * do cookie de sessão HttpOnly (autoritativo, não forjável) com a env do admin.
 * Lança "acesso negado" ANTES de qualquer efeito se não casar — é a ÚNICA linha
 * de defesa antes de elevar para service_role e atravessar o trigger de billing.
 */
export async function verificarAdminSaaS(): Promise<void> {
  let adminId: string;
  try {
    adminId = obterAdminUserId();
  } catch {
    // Fail-closed: env ausente bloqueia TODOS (D-5).
    throw new Error("acesso negado");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== adminId) {
    console.error("[admin] acesso negado", user?.id ?? "anon");
    throw new Error("acesso negado");
  }
}
