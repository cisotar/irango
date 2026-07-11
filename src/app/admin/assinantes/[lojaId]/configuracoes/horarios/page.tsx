import type { ReactElement } from "react";

import type { Horarios } from "@/lib/utils/lojaAberta";

import { carregarLojaAdminBase } from "../../carga";
import { HorariosAdminClient } from "./HorariosAdminClient";

/**
 * Sub-rota admin de Horários (issue 152). Server Component.
 *
 * A elevação a service_role fica no loader (`carregarLojaAdminBase`, com o guard
 * admin dentro dele), nunca na page. Repassa `horarios`/`timezone` já escopados
 * ao wrapper admin, que injeta `salvarHorariosAdmin` (093).
 */
export default async function HorariosConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const loja = await carregarLojaAdminBase(lojaId);

  return (
    <HorariosAdminClient
      lojaId={loja.id}
      inicial={loja.horarios as unknown as Horarios}
      timezone={loja.timezone}
    />
  );
}
