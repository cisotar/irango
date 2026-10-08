import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaAdminPorId, type LojaCompleta } from "@/lib/supabase/queries/lojas";
import type { FiltrosVendas } from "@/lib/validacoes/vendas";
import {
  carregarRelatorioVendas,
  type ResultadoRelatorioVendas,
} from "@/lib/vendas/carregarRelatorioVendas";

/**
 * Loader server-only (NÃO `'use server'`) do relatório de vendas da loja-alvo
 * no hub admin (issue 357). Molde: `carga-pedidos.ts`.
 *
 * Ordem inegociável (fail-closed):
 *  1. `validarLojaIdAdmin(lojaId)` — não-UUID → `notFound()` antes de qualquer leitura.
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA.
 *  3. `buscarLojaAdminPorId(svc, id)` — loja inexistente → `notFound()`.
 *  4. `carregarRelatorioVendas(svc, loja, …)` — sob service_role o escopo é o
 *     `WHERE loja_id = p_loja_id` das funções SQL, com o id já validado.
 *
 * O admin vê só o financeiro da loja: dado de cliente não passa por aqui (RN-V23).
 */
export async function carregarVendasLojaAdmin(
  lojaId: string,
  filtros: FiltrosVendas,
  agora: Date,
): Promise<{ loja: LojaCompleta; relatorio: ResultadoRelatorioVendas }> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }

  await verificarAdminSaaS();

  const svc = createServiceClient();
  const loja = await buscarLojaAdminPorId(svc, validacao.lojaId);
  if (loja == null) {
    notFound();
  }

  const relatorio = await carregarRelatorioVendas(svc, loja, filtros, agora);
  return { loja, relatorio };
}
