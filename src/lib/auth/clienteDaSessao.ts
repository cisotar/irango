import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buscarPerfilCliente } from "@/lib/supabase/queries/clientes";

/**
 * Issue 342 (RN-C02, decisão 18) — `cliente_id` AUTORITATIVO do pedido: vem do
 * `getUser()` do client da SESSÃO, nunca do payload. Só vincula conta com e-mail
 * confirmado E perfil em `clientes`. Regra (a): QUALQUER falha ao resolver a
 * sessão (sem cookie, rede, perfil ilegível) → convidado (`null`). Fail-safe:
 * convidado tem MENOS benefício (cupom com limite não se aplica), nunca mais.
 */
export async function resolverClienteDaSessao(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;
    if (error || !user || !user.email_confirmed_at) return null;
    const perfil = await buscarPerfilCliente(supabase, user.id);
    return perfil ? user.id : null;
  } catch {
    return null;
  }
}
