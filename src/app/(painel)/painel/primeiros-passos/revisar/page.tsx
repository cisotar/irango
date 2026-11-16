import type { ReactElement } from "react";
import { exigirAssistente } from "../guard";

// Página PROVISÓRIA da etapa "revisar" (issue 368, P6): só o guard e o título. A
// tela real (reuso da tela do painel) entra no P7.
export default async function EtapaRevisarPage(): Promise<ReactElement> {
  await exigirAssistente();
  return <h1 className="font-heading text-xl font-semibold">Revisar e publicar</h1>;
}
