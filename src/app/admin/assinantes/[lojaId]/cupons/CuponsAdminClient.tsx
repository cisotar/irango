"use client";

import { CuponsClient } from "@/app/(painel)/painel/cupons/CuponsClient";
import type { Cupom } from "@/lib/supabase/queries/entregaPagamento";
import {
  criarCupomAdmin,
  atualizarCupomAdmin,
  removerCupomAdmin,
} from "@/app/admin/assinantes/actions/admin-cupom";

/**
 * Wrapper client da aba Cupons do hub admin (issue 136). Reusa o `CuponsClient`
 * parametrizado do painel (127) — que já embute a listagem, o `Sheet` com
 * `FormCupom` e o `AlertDialog` de remoção — e INJETA as Server Actions admin
 * (134) com o `lojaId` da URL fixado via closures finas. Não copia markup algum.
 *
 * Segurança: `lojaId` aqui é só para montar a chamada. A autoridade real (prova
 * de admin antes do service_role, escopo cross-loja por `loja_id`+`id`, validação
 * do `cupomSchema` e recálculo do desconto no checkout) é das actions admin no
 * servidor. As actions admin têm assinatura `(lojaId, ...)`; os wrappers abaixo
 * adaptam para a forma sem `lojaId` que o `CuponsClient` espera (mesmas
 * assinaturas das actions do lojista). O wrapper NÃO é barreira (seguranca.md §2).
 */
export function CuponsAdminClient({
  lojaId,
  cupons,
}: {
  lojaId: string;
  cupons: Cupom[];
}) {
  return (
    <CuponsClient
      cupons={cupons}
      acoes={{
        criar: (payload) => criarCupomAdmin(lojaId, payload),
        atualizar: (id, payload) => atualizarCupomAdmin(lojaId, id, payload),
        remover: (id) => removerCupomAdmin(lojaId, id),
      }}
    />
  );
}
