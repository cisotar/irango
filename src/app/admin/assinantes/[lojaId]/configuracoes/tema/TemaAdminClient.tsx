"use client";

import {
  TemaClient,
  type Tema,
} from "@/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient";

import { salvarTemaAdmin } from "@/app/admin/assinantes/actions/admin-horarios-tema";

/**
 * Wrapper admin fino da sub-rota de Tema (issue 152). Reusa o `TemaClient` do
 * painel (097) e INJETA `salvarTemaAdmin` (093) com o `lojaId` da URL fixado por
 * closure. Cada cor é revalidada como hex `#RRGGBB` na action no servidor (sem
 * injeção de CSS) — aqui é só fiação de UI.
 */
export function TemaAdminClient({
  lojaId,
  temaInicial,
  nomeLoja,
}: {
  lojaId: string;
  temaInicial: Tema;
  nomeLoja: string;
}) {
  return (
    <TemaClient
      inicial={temaInicial}
      nomeLoja={nomeLoja}
      onSalvar={(payload) => salvarTemaAdmin(lojaId, payload)}
    />
  );
}
