import "server-only";

import type { User } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaPorDono } from "@/lib/supabase/queries/lojas";
import { reconciliarAssinatura } from "@/lib/assinatura/reconciliar";

/**
 * Reconciliação de assinatura órfã disparada na CONFIRMAÇÃO de email (issue 066).
 *
 * O único ponto onde a posse do email vira verdade é a troca do `code` por sessão
 * no callback. Por isso a reconciliação migra do cadastro (auth.ts, gate morto)
 * para cá: só dispara com `email_confirmed_at` setado e com o email AUTENTICADO da
 * sessão (RN-A1, não-forjável). Sem o gate, um atacante cadastraria com o email
 * EXATO da vítima e roubaria a assinatura órfã antes de provar posse.
 *
 * A loja é resolvida por `user.id` (vínculo canônico dono↔loja), nunca por email.
 *
 * BEST-EFFORT: tudo em try/catch → `console.error` + return, NUNCA propaga. Falha
 * aqui não pode derrubar o redirect do callback (a loja já existe em trial).
 */
export async function reconciliarPosConfirmacao(user: User): Promise<void> {
  try {
    // Gate: só com posse do email comprovada (auditoria 059, FIX 2 ALTA).
    if (!user.email_confirmed_at) return;

    const svc = createServiceClient();

    // Loja pelo user.id AUTENTICADO (vínculo canônico), nunca pelo email.
    const loja = await buscarLojaPorDono(svc, user.id);
    if (!loja) {
      console.warn("[reconciliarPosConfirmacao] usuário sem loja", { userId: user.id });
      return;
    }

    const email = user.email?.trim().toLowerCase();
    if (!email) return;

    await reconciliarAssinatura(svc, email, loja.id);
  } catch (e) {
    console.error("[reconciliarPosConfirmacao] falhou (best-effort)", e);
  }
}
