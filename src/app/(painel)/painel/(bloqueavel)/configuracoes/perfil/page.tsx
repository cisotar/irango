import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { podePublicarLoja } from "@/lib/utils/publicacao";
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
    />
  );
}
