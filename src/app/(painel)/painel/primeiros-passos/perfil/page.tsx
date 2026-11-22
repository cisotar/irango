import type { ReactElement } from "react";
import { PerfilClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient";
import { perfilInicialDaLoja } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/perfilInicial";
import { salvarPerfil } from "@/lib/actions/loja";
import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";
import { enviarImagemGaleria, listarImagensGaleria } from "@/lib/actions/galeria";
import { exigirAssistente } from "../guard";
import { NavegacaoEtapas } from "../NavegacaoEtapas";

/**
 * Etapa "Perfil" do assistente (issue 368). Mesmo `PerfilClient` e mesmas
 * actions do LOJISTA da page do painel; `topo={null}` explícito: publicar só
 * existe na etapa "revisar" (D8, DD6).
 */
export default async function EtapaPerfilPage(): Promise<ReactElement> {
  const { loja } = await exigirAssistente();
  return (
    <>
      <PerfilClient
        inicial={perfilInicialDaLoja(loja)}
        topo={null}
        logoUrlInicial={loja.logo_url}
        onSalvar={salvarPerfil}
        onSalvarLogo={salvarLogoLoja}
        onRemoverLogo={removerLogoLoja}
        onListarGaleria={listarImagensGaleria}
        onEnviarParaGaleria={enviarImagemGaleria}
      />
      <NavegacaoEtapas etapa="perfil" />
    </>
  );
}
