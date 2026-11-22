import type { ReactElement } from "react";
import OpcionaisPage from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page";
import { exigirAssistente } from "../guard";
import { NavegacaoEtapas } from "../NavegacaoEtapas";

/**
 * Etapa "Opcionais" do assistente (issue 368, DD5): renderiza a page do painel como
 * está — mesmo loader, mesmas Server Actions, nenhuma via de escrita própria.
 * O gate de `(bloqueavel)/layout.tsx` não roda (layout é por rota, não por
 * import), que é exatamente a isenção de D5.
 */
export default async function EtapaOpcionaisPage(): Promise<ReactElement> {
  await exigirAssistente();
  return (
    <>
      <OpcionaisPage />
      <NavegacaoEtapas etapa="opcionais" />
    </>
  );
}
