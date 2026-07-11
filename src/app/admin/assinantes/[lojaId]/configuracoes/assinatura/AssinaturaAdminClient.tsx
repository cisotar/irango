"use client";

import { useMemo } from "react";

import {
  GerenciarAssinaturaClient,
  type AcoesAssinatura,
  type PlanoView,
} from "@/components/painel/GerenciarAssinaturaClient";
import {
  iniciarAssinaturaAdmin,
  trocarPlanoAdmin,
  atualizarMeioPagamentoAssinaturaAdmin,
  cancelarAssinaturaAdmin,
} from "@/app/admin/assinantes/actions/admin-assinatura";

/**
 * Wrapper admin fino da sub-rota de Assinatura (issue 153). Reusa o
 * `GerenciarAssinaturaClient` parametrizado do painel (148) e INJETA as 4 actions
 * admin de billing (151) com o `lojaId` da URL fixado por closure.
 *
 * As actions do lojista têm forma `(payload)` / `()`; as admin têm `(lojaId, payload)`
 * / `(lojaId)`. Aqui adaptamos `(lojaId, payload) → (payload)` / `(lojaId) → ()`
 * fixando `lojaId` — mesmo padrão dos adapters do `PerfilAdminClient` (wrapper
 * `'use client'` com closure JS). Ambas retornam a MESMA união
 * `{ ok:true } | { ok:true; url } | { ok:false; erro }`, então as closures são
 * estruturalmente assinaláveis a `AcoesAssinatura`.
 *
 * Segurança: só fiação de UI. O `lojaId` é prop (não payload do cliente) — mesmo
 * adulterado, cada action re-prova admin e reescopa por `lojaId`. Preço vem de
 * `planos.preco` e status só do webhook (077); nenhuma decisão de valor/permissão
 * acontece aqui.
 */
export function AssinaturaAdminClient({
  lojaId,
  planos,
  planoAtualId,
  temAssinatura,
}: {
  lojaId: string;
  planos: PlanoView[];
  planoAtualId: string | null;
  temAssinatura: boolean;
}) {
  const acoes = useMemo<AcoesAssinatura>(
    () => ({
      iniciarAssinatura: (payload) => iniciarAssinaturaAdmin(lojaId, payload),
      trocarPlano: (payload) => trocarPlanoAdmin(lojaId, payload),
      atualizarMeioPagamentoAssinatura: () =>
        atualizarMeioPagamentoAssinaturaAdmin(lojaId),
      cancelarAssinatura: () => cancelarAssinaturaAdmin(lojaId),
    }),
    [lojaId],
  );

  return (
    <GerenciarAssinaturaClient
      planos={planos}
      planoAtualId={planoAtualId}
      temAssinatura={temAssinatura}
      acoes={acoes}
    />
  );
}
