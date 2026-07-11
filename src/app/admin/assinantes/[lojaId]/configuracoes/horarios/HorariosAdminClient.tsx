"use client";

import { HorariosClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/horarios/HorariosClient";
import type { Horarios } from "@/lib/utils/lojaAberta";

import { salvarHorariosAdmin } from "@/app/admin/assinantes/actions/admin-horarios-tema";

/**
 * Wrapper admin fino da sub-rota de Horários (issue 152). Reusa o
 * `HorariosClient` do painel (097) e INJETA `salvarHorariosAdmin` (093) com o
 * `lojaId` da URL fixado por closure. A regra `abre < fecha` é revalidada na
 * action no servidor — aqui é só fiação de UI.
 */
export function HorariosAdminClient({
  lojaId,
  inicial,
  timezone,
}: {
  lojaId: string;
  inicial: Horarios | null;
  timezone: string;
}) {
  return (
    <HorariosClient
      inicial={inicial}
      timezone={timezone}
      onSalvar={(payload) => salvarHorariosAdmin(lojaId, payload)}
    />
  );
}
