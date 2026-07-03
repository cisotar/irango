import type { ReactElement } from "react";

import { carregarOpcionaisAdmin } from "../../carga-opcionais";
import { OpcionaisAdminClient } from "./OpcionaisAdminClient";

/**
 * Aba Opcionais do hub admin (issue 142). Server Component.
 *
 * Carrega o agregado da loja-alvo via `carregarOpcionaisAdmin` (132) — que valida
 * o `lojaId` (UUID) → `notFound()`, re-prova admin ANTES de elevar a service_role
 * e escopa todas as queries por `lojaId`. A page NÃO repete nenhuma dessas
 * checagens (herda o fail-closed do loader e o guard/abas/cabeçalho do layout).
 *
 * O narrowing dos tipos largos do agregado para os shapes estreitos que o
 * `OpcionaisAdminClient` (via `Pick`) exige espelha a `page.tsx` do painel:
 * `categoriasProduto` e `associacoes` são mapeados para `{ id, nome }` /
 * `{ categoria_id, categoria_opcional_id }`; `categoriasOpcional` e `opcionais`
 * passam direto. Os campos `produtos`/`opcionaisPorCategoria` do agregado
 * pertencem à rota Cardápio (143) e não são consumidos aqui.
 */
export default async function OpcionaisAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { categoriasOpcional, opcionais, categoriasProduto, associacoes } =
    await carregarOpcionaisAdmin(lojaId);

  return (
    <OpcionaisAdminClient
      lojaId={lojaId}
      categoriasOpcional={categoriasOpcional}
      opcionais={opcionais}
      categoriasProduto={categoriasProduto.map((c) => ({
        id: c.id,
        nome: c.nome,
      }))}
      associacoes={associacoes.map((a) => ({
        categoria_id: a.categoria_id,
        categoria_opcional_id: a.categoria_opcional_id,
      }))}
    />
  );
}
