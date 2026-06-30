import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaAdminPorId, type LojaCompleta } from "@/lib/supabase/queries/lojas";
import { buscarCategorias, type Categoria } from "@/lib/supabase/queries/categorias";
import { buscarProdutosDoLojista, type Produto } from "@/lib/supabase/queries/produtos";
import {
  listarZonasComTaxas,
  listarFormasPagamento,
  type ZonaVitrine,
  type FormaPagamento,
} from "@/lib/supabase/queries/entregaPagamento";

/**
 * Agregado de leitura do painel admin SaaS para UMA loja-alvo (issue 096,
 * specs/admin-onboarding-assistido.md). Todos os dados já escopados por `lojaId`.
 */
export type LojaAdminAgregado = {
  loja: LojaCompleta;
  categorias: Categoria[];
  produtos: Produto[];
  zonas: ZonaVitrine[];
  formasPagamento: FormaPagamento[];
};

/**
 * Loader server-only (NÃO `'use server'`) do painel admin SaaS. Carrega os dados
 * da loja-alvo via service_role, ESCOPADOS por `lojaId`. Chamado por Server
 * Component admin.
 *
 * Ordem inegociável (fail-closed):
 *  1. `validarLojaIdAdmin(lojaId)` (083, z.guid()) — não-UUID → `notFound()` ANTES
 *     de qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA
 *     (RN-1, D-4): nenhuma elevação a service_role nem query acontece.
 *  3. `buscarLojaAdminPorId(svc, lojaId)` (TABELA base, enxerga loja inativa em
 *     onboarding); `null` → `notFound()`.
 *  4. Demais queries `(svc, lojaId)`, todas escopadas pela mesma `lojaId` validada.
 */
export async function carregarLojaAdmin(lojaId: string): Promise<LojaAdminAgregado> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const loja = await buscarLojaAdminPorId(svc, idValidado);
  if (!loja) {
    notFound();
  }

  const [categorias, produtos, zonas, formasPagamento] = await Promise.all([
    buscarCategorias(svc, idValidado),
    buscarProdutosDoLojista(svc, idValidado),
    listarZonasComTaxas(svc, idValidado),
    listarFormasPagamento(svc, idValidado),
  ]);

  return { loja, categorias, produtos, zonas, formasPagamento };
}
