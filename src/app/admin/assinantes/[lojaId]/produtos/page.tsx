import type { ReactElement } from "react";

import { carregarLojaAdmin } from "../carga";
import { carregarOpcionaisAdmin } from "../carga-opcionais";
import { CardapioAdminClient } from "./CardapioAdminClient";

/**
 * Rota Produtos (Cardápio) do hub admin (issue 100/143). Server Component.
 *
 * Carrega o agregado da loja-alvo via `carregarLojaAdmin` (096, loja/slug +
 * categorias + produtos) e os opcionais escopados via `carregarOpcionaisAdmin`
 * (132, opcionaisPorCategoria + categoriasOpcional) em `Promise.all`. Ambos
 * validam o `lojaId` (UUID), re-provam admin ANTES de elevar a service_role e
 * escopam todas as queries por `lojaId`. Passa loja/categorias/produtos +
 * opcionais reais ao wrapper client, que reusa o `ProdutosClient` do painel
 * (097) injetando as actions admin (088/089/090/135) com o `lojaId` fixado.
 *
 * O cabeçalho, as abas e o guard de admin vêm do `layout.tsx`.
 */
export default async function CardapioAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const [
    { loja, categorias, produtos },
    { opcionaisPorCategoria, categoriasOpcional },
  ] = await Promise.all([
    carregarLojaAdmin(lojaId),
    carregarOpcionaisAdmin(lojaId),
  ]);

  return (
    <CardapioAdminClient
      lojaSlug={loja.slug}
      lojaId={loja.id}
      produtos={produtos}
      categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
      opcionaisPorCategoria={opcionaisPorCategoria}
      categoriasOpcional={categoriasOpcional.map((c) => ({
        id: c.id,
        nome: c.nome,
      }))}
    />
  );
}
