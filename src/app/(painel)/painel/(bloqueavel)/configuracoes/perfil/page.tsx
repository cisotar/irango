import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { carregarProntidaoPublicacao } from "@/lib/supabase/queries/publicacao";
import { mensagemPendencia, podePublicarLoja } from "@/lib/utils/publicacao";
import { salvarPerfil, definirPublicacao } from "@/lib/actions/loja";
import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";
import { enviarImagemGaleria, listarImagensGaleria } from "@/lib/actions/galeria";
import { CartaoPublicacao } from "@/components/painel/CartaoPublicacao";
import { PerfilClient } from "./PerfilClient";
import { perfilInicialDaLoja } from "./perfilInicial";

/**
 * Página de perfil da loja (issue 040). Server Component.
 *
 * Carrega a loja do dono via client AUTENTICADO (RLS `lojas_leitura_propria`).
 * Sem loja → onboarding. A mutação acontece via Server Action `salvarPerfil`
 * (030), que revalida o payload e checa unicidade de slug no servidor.
 */
export default async function PerfilPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel");
  }

  // Preview do gate único de publicação (issue 368, D7); `definirPublicacao`
  // relê tudo do banco e decide.
  const prontidao = await carregarProntidaoPublicacao(supabase, loja);

  const gate = podePublicarLoja(prontidao);

  return (
    <PerfilClient
      inicial={perfilInicialDaLoja(loja)}
      // Gate único (mesma regra do servidor em definirPublicacao), só preview.
      topo={
        <CartaoPublicacao
          publicado={loja.ativo}
          bloqueio={gate.ok ? null : mensagemPendencia(gate.pendencia)}
          onDefinirPublicacao={definirPublicacao}
          destinoAposPublicar={null}
        />
      }
      logoUrlInicial={loja.logo_url}
      // Actions do LOJISTA passadas explicitamente (issue 160): as props do
      // `PerfilClient` são obrigatórias, sem default — a via admin injeta as
      // variantes escopadas por `lojaId`.
      onSalvar={salvarPerfil}
      onSalvarLogo={salvarLogoLoja}
      onRemoverLogo={removerLogoLoja}
      onListarGaleria={listarImagensGaleria}
      onEnviarParaGaleria={enviarImagemGaleria}
    />
  );
}
