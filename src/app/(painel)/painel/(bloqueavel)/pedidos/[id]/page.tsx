import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarPedidoDoDono } from "@/lib/supabase/queries/pedidos";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { variantesHabilitadas } from "@/lib/utils/variantesHabilitadas";
import { DetalhePedido } from "@/components/painel/DetalhePedido";

/**
 * Detalhe do pedido (issue 049) — casca fina (issue 125).
 *
 * Lê o pedido via client AUTENTICADO — a RLS `pedidos_acesso_lojista` garante
 * que o lojista só vê pedido da própria loja (RN-02). Pedido de outra loja ou
 * inexistente → `null` → `notFound()`. Toda a apresentação vive no componente
 * compartilhado `DetalhePedido`, consumido também pela page admin (140).
 *
 * RN-M1 (entitlement server-autoritativo, issue 136): a page faz a 2ª leitura de
 * `lojas` sob RLS (`buscarLojaDoDono`, MESMO client autenticado — escopo por
 * `dono_id`) e computa `variantesHabilitadas(loja)` no SSR. O guard `layout.tsx`
 * lê a loja mas NÃO propaga props a children, então a page decide o entitlement
 * ela mesma. Fail-closed: loja `null` → `[]` → sem seletor. `DetalhePedido` recebe
 * a lista PRONTA (nunca as flags cruas) e o nome da loja p/ o recibo.
 */
export default async function DetalhePedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createClient();

  const pedido = await buscarPedidoDoDono(supabase, id);
  if (pedido == null) {
    notFound();
  }

  // 2ª leitura sob RLS (MESMO client autenticado): entitlement de impressão
  // decidido no servidor. `variantesHabilitadas` é fail-closed (null → []).
  const loja = await buscarLojaDoDono(supabase);
  const modulosImpressao = variantesHabilitadas(loja);

  return (
    <DetalhePedido
      pedido={pedido}
      modulosImpressao={modulosImpressao}
      nomeLoja={loja?.nome ?? ""}
    />
  );
}
