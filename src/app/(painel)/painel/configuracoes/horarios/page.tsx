import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import type { Horarios } from "@/lib/utils/lojaAberta";
import { HorariosClient } from "./HorariosClient";

/**
 * Página de horários (issue 041). Server Component.
 *
 * Carrega a loja do dono via client AUTENTICADO (RLS). Salva via Server Action
 * `salvarHorarios` (030), que valida `abre < fecha` no servidor (RN-09).
 * `horarios`/`timezone` da loja alimentam o preview de "Aberta agora".
 */
export default async function HorariosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  return (
    <HorariosClient
      inicial={loja.horarios as unknown as Horarios}
      timezone={loja.timezone}
    />
  );
}
