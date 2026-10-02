"use client";

import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

/**
 * Opções da porta cliente (issue 336). `contexto: "cliente"` faz o callback
 * atribuir o papel `cliente` (só a conta sem papel). `next` segue codificado
 * na query do callback, que o sanitiza no servidor (RN-15). Sem opções =
 * porta `(auth)` do lojista, comportamento original.
 */
export type OpcoesEntrarComGoogle = { contexto?: "cliente"; next?: string };

export async function entrarComGoogle(opcoes?: OpcoesEntrarComGoogle) {
  const redirectTo = new URL("/auth/callback", window.location.origin);
  if (opcoes?.contexto === "cliente") {
    redirectTo.searchParams.set("contexto", "cliente");
    if (opcoes.next) redirectTo.searchParams.set("next", opcoes.next);
  }
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo.toString() },
  });
  if (error) {
    console.error("[entrarComGoogle]", error);
    toast.error("Não foi possível entrar com o Google. Tente novamente.");
  }
}
