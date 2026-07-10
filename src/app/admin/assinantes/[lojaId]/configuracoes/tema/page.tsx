import type { ReactElement } from "react";

import { montarTemaInicial } from "@/lib/utils/tema";

import { carregarLojaAdminBase } from "../../carga";
import { TemaAdminClient } from "./TemaAdminClient";

/**
 * Sub-rota admin de Tema (issue 152). Server Component.
 *
 * A elevação a service_role fica no loader (`carregarLojaAdminBase`, com o guard
 * admin dentro dele), nunca na page. Deriva o tema inicial pelo helper
 * compartilhado `montarTemaInicial` (sanitização hex, fallback seguro) e repassa
 * ao wrapper admin, que injeta `salvarTemaAdmin` (093).
 */
export default async function TemaConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const loja = await carregarLojaAdminBase(lojaId);

  return (
    <TemaAdminClient
      lojaId={loja.id}
      temaInicial={montarTemaInicial(loja.tema)}
      nomeLoja={loja.nome}
    />
  );
}
