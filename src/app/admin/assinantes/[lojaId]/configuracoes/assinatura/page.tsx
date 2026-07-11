import type { ReactElement } from "react";

import { CartaoStatusAssinatura } from "@/components/painel/CartaoStatusAssinatura";
import { AvisoEstadoBloqueado } from "@/components/painel/AvisoEstadoBloqueado";
import { TabelaFaturas } from "@/components/painel/TabelaFaturas";
import { type PlanoView } from "@/components/painel/GerenciarAssinaturaClient";
import { temAssinaturaAtiva } from "@/components/painel/rotulosAssinatura";

import { carregarAssinaturaAdmin } from "../../carga";
import { ModulosImpressaoAdmin } from "../ModulosImpressaoAdmin";
import { AssinaturaAdminClient } from "./AssinaturaAdminClient";

/**
 * Sub-rota admin de Assinatura (issue 153). Server Component — espelho da central
 * de assinatura do lojista operando sobre a loja-alvo.
 *
 * A elevação a service_role fica no loader (`carregarAssinaturaAdmin`, com o guard
 * admin dentro dele), nunca na page (mantém `enforcement-escopo-admin.test.ts`
 * verde). O loader escopa tudo por `lojaId`; a page só formata/roteia props.
 *
 * TODO valor é AUTORITATIVO do servidor: `preco` de `planos.preco` (RN-1), `valor`
 * das faturas do webhook (077) e `status` de `lojas.assinatura_status` — a UI nunca
 * recalcula (seguranca.md §10). As intenções de billing passam 100% pelas actions
 * admin (151), injetadas em `AssinaturaAdminClient` com o `lojaId` fixado.
 *
 * `ModulosImpressaoAdmin` (entitlement de módulos pagos) é card admin-only, IRMÃO e
 * ACIMA da view de assinatura — mesmo padrão da página consolidada. A remoção da
 * consolidada (duplicação transitória do card) é a issue 154.
 */
export default async function AssinaturaConfiguracaoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { loja, planoAtual, planos, faturas } =
    await carregarAssinaturaAdmin(lojaId);

  const planosView: PlanoView[] = planos.map((p) => ({
    id: p.id,
    nome: p.nome,
    preco: p.preco,
    intervalo: p.intervalo,
  }));

  const temAssinatura = temAssinaturaAtiva(
    loja.assinatura_status,
    loja.provider_subscription_id,
  );

  return (
    <div className="space-y-12">
      {/* Card admin-only (SaaS): entitlement dos módulos pagos, IRMÃO e ACIMA da
          view de assinatura (mesmo padrão da consolidada). Flags já em mãos do
          loader — zero query nova; a coerção fail-closed `=== true` é do componente. */}
      <ModulosImpressaoAdmin
        lojaId={loja.id}
        modulos={{
          a4: loja.modulo_impressao_a4,
          termica: loja.modulo_impressao_termica,
        }}
      />

      <div className="space-y-6">
        <AvisoEstadoBloqueado status={loja.assinatura_status} />

        <CartaoStatusAssinatura
          assinatura={{
            status: loja.assinatura_status,
            inicio: loja.assinatura_inicio,
            fimPeriodo: loja.assinatura_fim_periodo,
          }}
          plano={planoAtual}
        />

        <AssinaturaAdminClient
          lojaId={loja.id}
          planos={planosView}
          planoAtualId={loja.plano_id}
          temAssinatura={temAssinatura}
        />

        <TabelaFaturas faturas={faturas} />
      </div>
    </div>
  );
}
