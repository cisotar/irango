import type { ReactElement } from "react";

import { carregarCuponsAdmin } from "../carga-cupons";
import { CuponsAdminClient } from "./CuponsAdminClient";

/**
 * Aba Cupons do hub admin (issue 141, specs/paridade-hub-admin-painel.md rota 5).
 * Server Component. `dynamic = "force-dynamic"`: os cupons mudam por ação admin
 * (134) e o dado é sensível (nunca cacheado por rota), espelhando o layout.
 *
 * Carrega via `carregarCuponsAdmin` (loader server-only fail-closed: valida o
 * `lojaId`, prova admin ANTES de elevar a service_role e escopa a leitura por
 * `loja_id`). Passa `Cupom[]` direto ao `CuponsAdminClient` (136) — sem
 * mapeamento — que injeta as actions admin no `CuponsClient` do painel (127).
 * Nenhum valor autoritativo é decidido aqui: só fiação.
 */
export const dynamic = "force-dynamic";

export default async function CuponsAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const cupons = await carregarCuponsAdmin(lojaId);

  return <CuponsAdminClient lojaId={lojaId} cupons={cupons} />;
}
