import type { ReactElement } from "react";

import type { Horarios } from "@/lib/utils/lojaAberta";
import { montarTemaInicial } from "@/lib/utils/tema";

import { carregarLojaAdmin } from "../carga";
import { ConfiguracaoAdminClient } from "./ConfiguracaoAdminClient";
import { ModulosImpressaoAdmin } from "./ModulosImpressaoAdmin";

/**
 * Aba Configuração do hub admin (issue 101). Server Component.
 *
 * Carrega o agregado da loja-alvo via `carregarLojaAdmin` (096) — que valida o
 * `lojaId` (UUID), re-prova admin ANTES de elevar a service_role e escopa todas
 * as queries por `lojaId`. Passa loja/zonas/formasPagamento ao wrapper client,
 * que reusa os clients do painel (097: perfil, horários, tema, entregas,
 * pagamentos) injetando as actions admin (091–095) com o `lojaId` fixado.
 *
 * O cabeçalho, as abas e o guard de admin vêm do `layout.tsx`. Nenhum valor
 * autoritativo (geocoding, taxa, chave Pix, `ativo`) é decidido aqui — só fiação.
 */
export default async function ConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { loja, zonas, formasPagamento } = await carregarLojaAdmin(lojaId);

  const temaInicial = montarTemaInicial(loja.tema);

  return (
    <div className="space-y-12">
      {/* Card admin-only (SaaS): entitlement dos módulos pagos, IRMÃO e ACIMA do
          espelho de config do lojista. Flags já em mãos (carregarLojaAdmin) — zero
          query nova. Coluna NOT NULL + coerção `=== true` no componente = sem `?? false`. */}
      <ModulosImpressaoAdmin
        lojaId={loja.id}
        modulos={{
          a4: loja.modulo_impressao_a4,
          termica: loja.modulo_impressao_termica,
        }}
      />
      <ConfiguracaoAdminClient
        lojaId={loja.id}
        perfilInicial={{
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
        podePublicar={Boolean(loja.nome?.trim() && loja.whatsapp)}
        logoUrlInicial={loja.logo_url}
        horariosInicial={loja.horarios as unknown as Horarios}
        timezone={loja.timezone}
        temaInicial={temaInicial}
        nomeLoja={loja.nome}
        zonas={zonas}
        formasPagamento={formasPagamento}
      />
    </div>
  );
}
