import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  listarCuponsDaLoja,
  type Cupom,
} from "@/lib/supabase/queries/entregaPagamento";

/**
 * Loader server-only (NÃO `'use server'`) dos cupons da loja-alvo via
 * service_role, ESCOPADO por `lojaId` (issue 141,
 * specs/paridade-hub-admin-painel.md rota 5). Chamado pela `page.tsx` da aba
 * Cupons do hub admin; o retorno `Cupom[]` alimenta o `CuponsAdminClient` sem
 * mapeamento.
 *
 * Extraído para `carga*.ts` (em vez de elevar inline na `page.tsx`) para cair
 * sob o auto-discovery do `enforcement-escopo-admin.test.ts` — mesma lição de
 * 132/138. A page fica fininha e a chain fail-closed vira coberta por CI.
 *
 * Ordem inegociável (fail-closed), espelhando `carga-opcionais.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` (z.guid()) — não-UUID → `notFound()` ANTES de
 *     qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA:
 *     nenhuma elevação a service_role nem query acontece.
 *  3. `listarCuponsDaLoja(svc, lojaId)` escopada pela `lojaId` validada. Sob
 *     service_role (BYPASSRLS) a isolação cross-tenant é o `.eq("loja_id")` da
 *     query — não a RLS. Cupom nunca tem SELECT público (seguranca.md §2).
 */
export async function carregarCuponsAdmin(lojaId: string): Promise<Cupom[]> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  return listarCuponsDaLoja(svc, idValidado);
}
