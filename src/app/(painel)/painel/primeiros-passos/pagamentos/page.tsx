import type { ReactElement } from "react";
import PagamentosPage from "@/app/(painel)/painel/(bloqueavel)/configuracoes/pagamentos/page";
import { exigirAssistente } from "../guard";
import { NavegacaoEtapas } from "../NavegacaoEtapas";

/**
 * Etapa "Pagamentos" do assistente (issue 368, DD5): renderiza a page do painel como
 * está — mesmo loader, mesmas Server Actions, nenhuma via de escrita própria.
 * O gate de `(bloqueavel)/layout.tsx` não roda (layout é por rota, não por
 * import), que é exatamente a isenção de D5.
 */
export default async function EtapaPagamentosPage(): Promise<ReactElement> {
  await exigirAssistente();
  return (
    <>
      <PagamentosPage />
      <NavegacaoEtapas etapa="pagamentos" />
    </>
  );
}
