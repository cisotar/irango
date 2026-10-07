import type { ReactElement } from "react";

import { carregarGaleriaAdmin } from "../carga-galeria";
import { GaleriaAdminClient } from "./GaleriaAdminClient";

/**
 * Galeria da loja-alvo no hub admin (specs/galeria-imagens-loja.md, página 2).
 * Server Component. `dynamic = "force-dynamic"`: a galeria muda por ação admin
 * e o dado é da loja de outro lojista (nunca cacheado por rota), como o layout.
 *
 * Carrega via `carregarGaleriaAdmin` (fail-closed: valida o `lojaId`, prova
 * admin ANTES de elevar a service_role e escopa toda leitura por `loja_id`) e
 * entrega ao `GaleriaAdminClient`, que injeta as actions `*Admin`. Só fiação.
 */
export const dynamic = "force-dynamic";

export default async function GaleriaAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { pagina, total, usos } = await carregarGaleriaAdmin(lojaId);

  return (
    <GaleriaAdminClient
      lojaId={lojaId}
      imagensIniciais={pagina.imagens}
      cursorInicial={pagina.proximo_cursor}
      totalInicial={total}
      usosIniciais={usos}
    />
  );
}
