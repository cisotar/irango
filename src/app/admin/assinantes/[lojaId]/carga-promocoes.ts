import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarCategorias, type Categoria } from "@/lib/supabase/queries/categorias";
import {
  listarModaisSazonaisDoDono,
  type ModalSazonalComSelecao,
} from "@/lib/supabase/queries/modaisSazonais";

export type PromocoesAdminAgregado = {
  /** Todos os modais da loja-alvo, inclusive rascunhos/inativos, com a seleção. */
  modais: ModalSazonalComSelecao[];
  /** Categorias da loja-alvo para os checkboxes de seleção. */
  categorias: Categoria[];
};

/**
 * Loader server-only (NÃO `'use server'`) dos AVISOS (modal sazonal) da
 * loja-alvo via service_role, ESCOPADO por `lojaId` — issue 362, sub-rota admin
 * `/admin/assinantes/[lojaId]/configuracoes/promocoes`. Nome `carga*.ts` de
 * propósito: cai no auto-discovery do `enforcement-escopo-admin.test.ts`.
 *
 * Ordem inegociável (fail-closed), espelhando `carga-galeria.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` (z.guid()) — não-UUID → `notFound()` ANTES de
 *     qualquer leitura (nenhum service client, nenhuma query);
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA;
 *  3. leituras escopadas pela `lojaId` validada. Sob service_role (BYPASSRLS) a
 *     barreira é o `.eq("loja_id", lojaId)` EXPLÍCITO das duas queries (ver o
 *     cabeçalho de `queries/modaisSazonais.ts`), não a RLS.
 *
 * A elevação a service_role fica AQUI, nunca em `page.tsx` (decisão b, issue
 * 150) — a página recebe só o dado materializado.
 */
export async function carregarPromocoesAdmin(
  lojaId: string,
): Promise<PromocoesAdminAgregado> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const [modais, categorias] = await Promise.all([
    listarModaisSazonaisDoDono(svc, idValidado),
    buscarCategorias(svc, idValidado),
  ]);

  return { modais, categorias };
}
