import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarCuponsDoDono } from "@/lib/supabase/queries/entregaPagamento";
import { CuponsClient } from "./CuponsClient";

/**
 * Página de gestão de cupons (issue 045). Server Component.
 *
 * Lista os cupons do dono via client AUTENTICADO (RLS `cupons_acesso_proprio`).
 * Sem loja → onboarding. CRUD via Server Actions de cupom (032), que derivam
 * `loja_id` do dono e impõem código único no servidor.
 */
export default async function CuponsPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const cupons = await listarCuponsDoDono(supabase);

  return <CuponsClient cupons={cupons} />;
}
