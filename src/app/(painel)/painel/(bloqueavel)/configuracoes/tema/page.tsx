import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { TemaClient, type Tema } from "./TemaClient";

const TEMA_PADRAO: Tema = {
  primaria: "#e11d48",
  fundo: "#ffffff",
  destaque: "#f59e0b",
};

const reHex = /^#[0-9a-fA-F]{6}$/;

/** Lê uma cor do jsonb com fallback seguro se ausente/inválida. */
function lerCor(tema: Record<string, unknown>, chave: keyof Tema): string {
  const v = tema[chave];
  return typeof v === "string" && reHex.test(v) ? v : TEMA_PADRAO[chave];
}

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

  const temaJson = (loja.tema ?? {}) as Record<string, unknown>;
  const inicial: Tema = {
    primaria: lerCor(temaJson, "primaria"),
    fundo: lerCor(temaJson, "fundo"),
    destaque: lerCor(temaJson, "destaque"),
  };

  return <TemaClient inicial={inicial} nomeLoja={loja.nome} />;
}
