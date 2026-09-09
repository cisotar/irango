import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { podePublicarLoja } from "@/lib/utils/publicacao";
import { salvarPerfil, definirPublicacao } from "@/lib/actions/loja";
import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";
import { PerfilClient } from "./PerfilClient";

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
    redirect("/painel/onboarding");
  }

  return (
    <PerfilClient
      inicial={{
        nome: loja.nome,
        slug: loja.slug,
        telefone: loja.telefone,
        whatsapp: loja.whatsapp,
        whatsapp_envio_automatico: loja.whatsapp_envio_automatico,
        endereco_cep: loja.endereco_cep,
        endereco_rua: loja.endereco_rua,
        endereco_numero: loja.endereco_numero,
        endereco_bairro: loja.endereco_bairro,
        endereco_cidade: loja.endereco_cidade,
        endereco_estado: loja.endereco_estado,
      }}
      publicado={loja.ativo}
      // Perfil mínimo para publicar (mesma regra do servidor em definirPublicacao).
      podePublicar={podePublicarLoja(loja.nome, loja.whatsapp)}
      logoUrlInicial={loja.logo_url}
      // Actions do LOJISTA passadas explicitamente (issue 160): as props do
      // `PerfilClient` são obrigatórias, sem default — a via admin injeta as
      // variantes escopadas por `lojaId`.
      onSalvar={salvarPerfil}
      onDefinirPublicacao={definirPublicacao}
      onSalvarLogo={salvarLogoLoja}
      onRemoverLogo={removerLogoLoja}
    />
  );
}
