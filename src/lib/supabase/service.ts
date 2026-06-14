import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Client com a SERVICE_ROLE key — ignora RLS (BYPASSRLS).
 *
 * ⚠️ USO EXCLUSIVO SERVER-SIDE. O `import "server-only"` faz o build QUEBRAR se
 * este módulo for importado por qualquer código `'use client'`. Nunca exponha a
 * service_role ao browser (seguranca.md §7).
 *
 * Use só onde a RLS precisa ser legitimamente contornada com escopo manual na
 * query: validar cupom por código (013), ler pedido por id+token (026/037),
 * checar unicidade de slug (030), webhook Hotmart (057). Toda query feita com
 * este client DEVE escopar manualmente (loja_id, token, etc.) — o RLS não protege.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "createServiceClient: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente.",
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
