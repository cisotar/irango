import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarPedidoDaLoja,
  type PedidoComItens,
} from "@/lib/supabase/queries/pedidos";

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
 */
export async function carregarPedidoDetalheAdmin(
  lojaId: string,
  id: string,
): Promise<PedidoComItens> {
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

  return pedido;
}
