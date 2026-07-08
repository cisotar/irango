import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaAdminPorId } from "@/lib/supabase/queries/lojas";
import {
  buscarPedidoDaLoja,
  type PedidoComItens,
} from "@/lib/supabase/queries/pedidos";
import {
  variantesHabilitadas,
  type VarianteImpressao,
} from "@/lib/utils/variantesHabilitadas";

/** Retorno do loader admin: pedido + entitlement de impressão da loja-ALVO. */
export type PedidoDetalheAdmin = {
  pedido: PedidoComItens;
  modulosImpressao: VarianteImpressao[];
  nomeLoja: string;
};

/**
 * Loader server-only (NÃO `'use server'`) do detalhe do pedido da loja-alvo via
 * service_role, ESCOPADO por `lojaId` + `id`, para a page admin (issue 140,
 * specs/paridade-hub-admin-painel.md rota 4). Chamado por Server Component admin;
 * alimenta `<DetalhePedido>` (125) — nenhum markup nem cálculo monetário aqui.
 *
 * Ordem inegociável (fail-closed), espelhando `carga-pedidos.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` (z.guid()) — não-UUID → `notFound()` ANTES de
 *     qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA:
 *     nenhuma elevação a service_role nem query acontece.
 *  3. `buscarPedidoDaLoja(svc, idValidado, id)` — sob service_role (BYPASSRLS) a
 *     isolação cross-tenant é o duplo `.eq("loja_id").eq("id")` da query (130) com
 *     a `lojaId` validada, não a RLS. Pedido de OUTRA loja / inexistente / `id`
 *     inválido → `null` → `notFound()` (anti-enumeração: indistinguíveis).
 *
 * RN-M2 (issue 137 — espelho do entitlement): SÓ DEPOIS de o pedido existir, uma
 * 2ª leitura ESCOPADA `buscarLojaAdminPorId(svc, idValidado)` (`.eq("id", lojaId)`
 * com o MESMO `lojaId` validado, NUNCA do payload nem a loja do admin) alimenta
 * `variantesHabilitadas` — o MESMO util do painel (DRY / anti-drift). A leitura da
 * flag vem DEPOIS da prova de admin e da elevação. Fail-closed no ENTITLEMENT (não
 * no pedido): loja-alvo `null` → `[]`, SEM `notFound` — o pedido já foi encontrado.
 */
export async function carregarPedidoDetalheAdmin(
  lojaId: string,
  id: string,
): Promise<PedidoDetalheAdmin> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const pedido = await buscarPedidoDaLoja(svc, idValidado, id);
  if (pedido == null) {
    notFound();
  }

  // Entitlement de impressão da loja-ALVO. Escopo por `idValidado` (o MESMO lojaId
  // validado): sob service_role (BYPASSRLS) o isolamento cross-tenant é esse
  // `.eq("id", lojaId)`, não a RLS. Fail-closed: loja `null` → `variantesHabilitadas`
  // devolve `[]` (sem notFound — o pedido existe, só o entitlement é vazio).
  const loja = await buscarLojaAdminPorId(svc, idValidado);
  const modulosImpressao = variantesHabilitadas(loja);
  const nomeLoja = loja?.nome ?? "";

  return { pedido, modulosImpressao, nomeLoja };
}
