import type { ReactElement } from "react";

import { EntregasConteudo } from "./EntregasConteudo";

/**
 * Página de zonas de entrega (issue 046). Casca de `EntregasConteudo` (issue
 * 368, DD5): o loader e a tela são os mesmos da etapa "entregas" do assistente.
 */
export default function EntregasPage(): ReactElement {
  return <EntregasConteudo hrefPerfil="/painel/configuracoes/perfil" />;
}
