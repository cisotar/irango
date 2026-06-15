import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarZonasComTaxas } from "@/lib/supabase/queries/entregaPagamento";
import { EntregasClient } from "./EntregasClient";

/**
 * Página de zonas de entrega (issue 046). Server Component.
 *
 * Lista as zonas do dono (com taxa 1:1 e bairros 1:N) via client AUTENTICADO
 * (RLS `zonas_escrita_propria`/leitura própria). Sem loja → onboarding. CRUD via
 * Server Actions de entrega (032/046), que derivam `loja_id` do dono.
 */
export default async function EntregasPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const zonas = await listarZonasComTaxas(supabase, loja.id);

  return <EntregasClient zonas={zonas} />;
}
