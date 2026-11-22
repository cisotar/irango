import { redirect } from "next/navigation";
import { pendenciasPublicacao } from "@/lib/utils/publicacao";
import { etapaDeRetomada, rotaDaEtapa } from "@/lib/utils/primeirosPassos";
import { exigirAssistente } from "./guard";

/**
 * Entrada do assistente (D6): redireciona para a primeira etapa com pendência
 * do gate de publicação; sem pendência, para "revisar".
 */
export default async function PrimeirosPassosPage(): Promise<never> {
  const { estado } = await exigirAssistente();
  redirect(rotaDaEtapa(etapaDeRetomada(pendenciasPublicacao(estado))));
}
