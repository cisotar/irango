import type { ReactElement } from "react";

import { carregarLojaAdminBase, carregarZonasAdmin } from "../../carga";
import { modalidadesDaLoja } from "@/lib/utils/modalidadesEntrega";
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
  // Loja (modalidades + fallback fora-de-zona) e zonas: loaders de seção
  // independentes, cada um com o próprio guard admin — em paralelo.
  // A versão otimista vem no MESMO select das zonas (issue 328): o paralelismo
  // com a loja não quebra a atomicidade versão × zonas.
  const [loja, { versao, forma, zonas }] = await Promise.all([
    carregarLojaAdminBase(lojaId),
    carregarZonasAdmin(lojaId),
  ]);

  return (
    <EntregasAdminClient
      lojaId={lojaId}
      zonas={zonas}
      forma={forma}
      versao={versao}
      // Só o boolean: o par de coordenadas nunca vai ao client (seguranca.md §19).
      temCoordenadas={loja.latitude != null && loja.longitude != null}
      hrefPerfil={`/admin/assinantes/${lojaId}/configuracoes/perfil`}
      modalidades={modalidadesDaLoja(loja)}
      taxaForaZona={loja.taxa_entrega_fora_zona}
    />
  );
}
