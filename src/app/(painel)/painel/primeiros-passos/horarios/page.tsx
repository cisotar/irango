import type { ReactElement } from "react";
import { exigirAssistente } from "../guard";

// Página PROVISÓRIA da etapa "horarios" (issue 368, P6): só o guard e o título. A
// tela real (reuso da tela do painel) entra no P7.
export default async function EtapaHorariosPage(): Promise<ReactElement> {
  await exigirAssistente();
  return <h1 className="font-heading text-xl font-semibold">Horários</h1>;
}
