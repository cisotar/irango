import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { montarTemaInicial } from "@/lib/utils/tema";
import { salvarTema } from "@/lib/actions/loja";
import { TemaClient } from "./TemaClient";

/**
 * Página de tema (issue 042). Server Component.
 *
 * Carrega a loja do dono via client AUTENTICADO (RLS). Salva via `salvarTema`
 * (030), que valida cada cor como hex `#RRGGBB` no servidor (sem injeção CSS).
 */
export default async function TemaPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  return (
    <TemaClient
      inicial={montarTemaInicial(loja.tema)}
      nomeLoja={loja.nome}
      // Action do LOJISTA passada explicitamente (issue 160): a prop é
      // obrigatória, sem default — a via admin injeta a variante por `lojaId`.
      onSalvar={salvarTema}
    />
  );
}
