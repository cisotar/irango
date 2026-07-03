import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarCategorias, type Categoria } from "@/lib/supabase/queries/categorias";
import {
  buscarProdutosDoLojista,
  buscarOpcionaisPorCategoriaDaLoja,
  type Produto,
  type OpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import {
  buscarCategoriasOpcional,
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
  type CategoriaOpcional,
  type Opcional,
  type AssociacaoCategoriaProdutoOpcional,
} from "@/lib/supabase/queries/opcionais";

/**
 * Agregado de leitura de opcionais do painel admin SaaS para UMA loja-alvo
 * (issue 132, specs/paridade-hub-admin-painel.md). Fonte única compartilhada
 * pelas rotas Opcionais (6/142) e Cardápio (7/143). Todos os dados já escopados
 * por `lojaId` sob `service_role`.
 */
export type OpcionaisAdminAgregado = {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
  categoriasProduto: Categoria[];
  associacoes: AssociacaoCategoriaProdutoOpcional[];
  produtos: Produto[];
  opcionaisPorCategoria: OpcionaisPorCategoria;
};

/**
 * Loader server-only (NÃO `'use server'`) dos opcionais da loja-alvo via
 * service_role, ESCOPADO por `lojaId`. Chamado por Server Component admin.
 *
 * Ordem inegociável (fail-closed), espelhando `carga.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` (z.guid()) — não-UUID → `notFound()` ANTES de
 *     qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA:
 *     nenhuma elevação a service_role nem query acontece.
 *  3. Queries `(svc, lojaId)`, todas escopadas pela mesma `lojaId` validada. Sob
 *     service_role (BYPASSRLS) a isolação cross-tenant é o `.eq("loja_id")` de
 *     cada query — não a RLS. `buscarOpcionaisPorCategoriaDaLoja` é a variante
 *     escopada (a original delegaria o escopo à RLS anon, ausente aqui).
 */
export async function carregarOpcionaisAdmin(
  lojaId: string,
): Promise<OpcionaisAdminAgregado> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  // `buscarOpcionaisPorCategoriaDaLoja` precisa dos ids já resolvidos de
  // `buscarCategorias`, então as duas rodam em sequência no mesmo ramo do
  // `Promise.all`, preservando o paralelismo com as demais queries.
  const [
    categoriasOpcional,
    opcionais,
    associacoes,
    produtos,
    { categoriasProduto, opcionaisPorCategoria },
  ] = await Promise.all([
    buscarCategoriasOpcional(svc, idValidado),
    buscarOpcionaisDoLojista(svc, idValidado),
    buscarAssociacoesOpcional(svc, idValidado),
    buscarProdutosDoLojista(svc, idValidado),
    (async () => {
      const categoriasProduto = await buscarCategorias(svc, idValidado);
      const opcionaisPorCategoria = await buscarOpcionaisPorCategoriaDaLoja(
        svc,
        idValidado,
        categoriasProduto.map((c) => c.id),
      );
      return { categoriasProduto, opcionaisPorCategoria };
    })(),
  ]);

  return {
    categoriasOpcional,
    opcionais,
    categoriasProduto,
    associacoes,
    produtos,
    opcionaisPorCategoria,
  };
}
