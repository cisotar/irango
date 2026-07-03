import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  listarPedidosDaLoja,
  type PedidoComItens,
} from "@/lib/supabase/queries/pedidos";

/**
 * Loader server-only (NÃO `'use server'`) dos pedidos da loja-alvo via
 * service_role, ESCOPADO por `lojaId`, para o Dashboard admin (issue 138,
 * specs/paridade-hub-admin-painel.md rota 2). Chamado por Server Component admin;
 * alimenta `<DashboardLoja>` (122) — nenhum markup nem cálculo monetário aqui.
 *
 * Ordem inegociável (fail-closed), espelhando `carga-opcionais.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` (z.guid()) — não-UUID → `notFound()` ANTES de
 *     qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA:
 *     nenhuma elevação a service_role nem query acontece.
 *  3. `listarPedidosDaLoja(svc, idValidado)` — sob service_role (BYPASSRLS) a
 *     isolação cross-tenant é o `.eq("loja_id")` da query com a `lojaId` validada,
 *     não a RLS. `total` já autoritativo (issue 012); métricas somam no servidor.
 */
export async function carregarDashboardLojaAdmin(
  lojaId: string,
): Promise<PedidoComItens[]> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  return listarPedidosDaLoja(svc, idValidado);
}
