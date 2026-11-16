import type { ReactElement } from "react";

import { mensagemPendencia, podePublicarLoja } from "@/lib/utils/publicacao";
import { carregarLojaAdminBase, carregarProntidaoAdmin } from "../../carga";
import { perfilInicialDaLoja } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/perfilInicial";
import { PerfilAdminClient } from "./PerfilAdminClient";

/**
 * Sub-rota admin de Perfil (issue 152). Server Component.
 *
 * A elevação a service_role fica no loader (`carregarLojaAdminBase`, com o guard
 * admin dentro dele), nunca na page (mantém `enforcement-escopo-admin.test.ts`
 * verde). Repassa os dados já escopados por `lojaId` ao wrapper admin, que injeta
 * as actions admin (091). `bloqueio` (texto D10 da 1ª pendência do gate único,
 * issue 368) é preview; o gate real é revalidado em `publicarLojaAdmin`.
 */
export default async function PerfilConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const [loja, prontidao] = await Promise.all([
    carregarLojaAdminBase(lojaId),
    carregarProntidaoAdmin(lojaId),
  ]);
  const gate = podePublicarLoja(prontidao);
  const bloqueio = gate.ok ? null : mensagemPendencia(gate.pendencia);

  return (
    <PerfilAdminClient
      lojaId={loja.id}
      inicial={perfilInicialDaLoja(loja)}
      publicado={loja.ativo}
      // Gate único (mesma regra do servidor em publicarLojaAdmin), só preview.
      bloqueio={bloqueio}
      logoUrlInicial={loja.logo_url}
    />
  );
}
