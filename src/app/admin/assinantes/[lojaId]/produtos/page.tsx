import type { ReactElement } from "react";

import { carregarLojaAdmin } from "../carga";
import { CardapioAdminClient } from "./CardapioAdminClient";

/**
 * Aba Cardápio do hub admin (issue 100). Server Component.
 *
 * Carrega o agregado da loja-alvo via `carregarLojaAdmin` (096) — que valida o
 * `lojaId` (UUID), re-prova admin ANTES de elevar a service_role e escopa todas
 * as queries por `lojaId`. Passa loja/categorias/produtos ao wrapper client, que
 * reusa o `ProdutosClient` do painel (097) injetando as actions admin (088/089/090)
 * com o `lojaId` fixado.
 *
 * O cabeçalho, as abas e o guard de admin vêm do `layout.tsx`.
 */
export default async function CardapioAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { loja, categorias, produtos } = await carregarLojaAdmin(lojaId);

  return (
    <CardapioAdminClient
      lojaSlug={loja.slug}
      lojaId={loja.id}
      produtos={produtos}
      categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
    />
  );
}
