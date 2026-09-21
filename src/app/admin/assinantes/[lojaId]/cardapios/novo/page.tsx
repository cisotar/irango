import type { ReactElement } from "react";
import Link from "next/link";

import { carregarLojaAdmin } from "../../carga";
import { horaLocalNoFuso, rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";
import { NovoCardapioAdminClient } from "./NovoCardapioAdminClient";

export const dynamic = "force-dynamic";

/**
 * [269 · fase 6] `/admin/assinantes/[lojaId]/cardapios/novo` — o gêmeo admin de
 * `/painel/cardapios/novo`. Rota própria (não modal), como no lojista: sete
 * controles e uma prévia não cabem num `Dialog` de 360px (`design-system.md` §1).
 *
 * `agoraLocal` e o rótulo do fuso descem prontos do SERVIDOR, com o relógio do
 * servidor e o fuso da LOJA-ALVO.
 */
export default async function NovoCardapioAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { loja } = await carregarLojaAdmin(lojaId);

  const agora = new Date();

  return (
    <div className="flex flex-col gap-4">
      <Link href={rotaCardapiosAdmin(loja.id)} className="text-sm underline">
        Voltar para cardápios
      </Link>
      <h1 className="text-xl font-semibold">Novo cardápio</h1>
      <NovoCardapioAdminClient
        lojaId={loja.id}
        timezone={loja.timezone}
        fusoRotulo={rotuloFusoLoja(loja.timezone, agora)}
        agoraLocal={horaLocalNoFuso(agora.toISOString(), loja.timezone)}
      />
    </div>
  );
}
