import type { ReactElement } from "react";

import { carregarFormasPagamentoAdmin } from "../../carga";
import { PagamentosAdminClient } from "./PagamentosAdminClient";

/**
 * Sub-rota admin de Pagamentos (issue 152). Server Component.
 *
 * A elevação a service_role fica no loader de seção
 * (`carregarFormasPagamentoAdmin`, com o guard admin dentro dele), nunca na page.
 * Repassa as formas já escopadas por `lojaId` ao wrapper admin, que injeta as
 * actions de pagamento (095). O `lojaId` vem de `params` (fixado no servidor).
 */
export default async function PagamentosConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const formasPagamento = await carregarFormasPagamentoAdmin(lojaId);

  return (
    <PagamentosAdminClient lojaId={lojaId} formasPagamento={formasPagamento} />
  );
}
