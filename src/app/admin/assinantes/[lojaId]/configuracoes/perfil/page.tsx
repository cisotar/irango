import type { ReactElement } from "react";

import { podePublicarLoja } from "@/lib/utils/publicacao";
import { carregarLojaAdminBase } from "../../carga";
import { PerfilAdminClient } from "./PerfilAdminClient";

/**
 * Sub-rota admin de Perfil (issue 152). Server Component.
 *
 * A elevação a service_role fica no loader (`carregarLojaAdminBase`, com o guard
 * admin dentro dele), nunca na page (mantém `enforcement-escopo-admin.test.ts`
 * verde). Repassa os dados já escopados por `lojaId` ao wrapper admin, que injeta
 * as actions admin (091). `podePublicar` (nome + WhatsApp) é preview; o gate real
 * é revalidado em `publicarLojaAdmin`.
 */
export default async function PerfilConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const loja = await carregarLojaAdminBase(lojaId);

  return (
    <PerfilAdminClient
      lojaId={loja.id}
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
      // Perfil mínimo para publicar (mesma regra do servidor em publicarLojaAdmin).
      podePublicar={podePublicarLoja(loja.nome, loja.whatsapp)}
      logoUrlInicial={loja.logo_url}
    />
  );
}
