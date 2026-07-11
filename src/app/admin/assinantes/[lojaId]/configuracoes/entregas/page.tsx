import type { ReactElement } from "react";

import { carregarZonasAdmin } from "../../carga";
import { EntregasAdminClient } from "./EntregasAdminClient";

/**
 * Sub-rota admin de Entregas (issue 152). Server Component.
 *
 * A elevação a service_role fica no loader de seção (`carregarZonasAdmin`, com o
 * guard admin dentro dele), nunca na page. Repassa as zonas já escopadas por
 * `lojaId` ao wrapper admin, que injeta as actions de zona (094). O `lojaId` vem
 * de `params` (fixado no servidor).
 */
export default async function EntregasConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const zonas = await carregarZonasAdmin(lojaId);

  return <EntregasAdminClient lojaId={lojaId} zonas={zonas} />;
}
