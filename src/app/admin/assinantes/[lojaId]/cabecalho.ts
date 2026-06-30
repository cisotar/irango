import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaAdminPorId } from "@/lib/supabase/queries/lojas";

/**
 * Dados LEVES do cabeçalho do hub admin (issue 099). Só o necessário para o
 * `layout.tsx` renderizar nome/slug/status da loja-alvo — NÃO o agregado completo
 * de `carregarLojaAdmin` (096), que as sub-rotas (100/101) carregam por conta.
 */
export type CabecalhoLojaAdmin = {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
};

/**
 * Loader server-only do cabeçalho do hub. Mesma ordem fail-closed da carga (096):
 *  1. `validarLojaIdAdmin(lojaId)` — não-UUID → `notFound()` ANTES de qualquer leitura.
 *  2. `verificarAdminSaaS()` ANTES de elevar a service_role — a falha PROPAGA (D-4).
 *  3. `buscarLojaAdminPorId(svc, lojaId)` (tabela base, enxerga loja inativa); `null`
 *     → `notFound()`.
 *
 * Decisão de carga (issue 099): o `layout.tsx` NÃO recebe os dados resolvidos da
 * sub-página. Para evitar dupla carga do agregado pesado, o layout carrega só este
 * cabeçalho leve (uma query escopada por `lojaId`), enquanto cada sub-rota (cardápio
 * /configuração) chama `carregarLojaAdmin` para os dados completos.
 */
export async function carregarCabecalhoLojaAdmin(
  lojaId: string,
): Promise<CabecalhoLojaAdmin> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }

  await verificarAdminSaaS();

  const svc = createServiceClient();
  const loja = await buscarLojaAdminPorId(svc, validacao.lojaId);
  if (!loja) {
    notFound();
  }

  return { id: loja.id, nome: loja.nome, slug: loja.slug, ativo: loja.ativo };
}
