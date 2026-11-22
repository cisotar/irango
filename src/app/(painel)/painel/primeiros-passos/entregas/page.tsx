import type { ReactElement } from "react";
import { EntregasConteudo } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasConteudo";
import { rotaDaEtapa } from "@/lib/utils/primeirosPassos";
import { exigirAssistente } from "../guard";
import { NavegacaoEtapas } from "../NavegacaoEtapas";

/**
 * Etapa "Entregas" do assistente (issue 368, DD5): mesmo conteúdo da page do
 * painel; só o link para completar o endereço aponta para a etapa perfil.
 */
export default async function EtapaEntregasPage(): Promise<ReactElement> {
  await exigirAssistente();
  return (
    <>
      <EntregasConteudo hrefPerfil={rotaDaEtapa("perfil")} />
      <NavegacaoEtapas etapa="entregas" />
    </>
  );
}
