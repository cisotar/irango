import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarFormasPagamento } from "@/lib/supabase/queries/entregaPagamento";
import { PagamentosClient } from "./PagamentosClient";

/**
 * Página de formas de pagamento (issue 047). Server Component.
 *
 * Lista as formas do dono via client AUTENTICADO (RLS
 * `pagamentos_escrita_propria`/leitura própria). Sem loja → onboarding. CRUD via
 * Server Actions de pagamento (032/047), que derivam `loja_id` do dono e
 * revalidam o formato da chave Pix no servidor.
 */
export default async function PagamentosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const formas = await listarFormasPagamento(supabase, loja.id);

  return <PagamentosClient formas={formas} lojaId={loja.id} />;
}
