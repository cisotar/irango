import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  buscarProdutosDoLojista,
  buscarOpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { buscarCategoriasOpcional } from "@/lib/supabase/queries/opcionais";
import {
  removerProduto,
  alternarDisponibilidade,
  alternarOculto,
  criarProduto,
  atualizarProduto,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
  alternarExibirImagens,
  reordenarCategorias,
} from "@/lib/actions/produto";
import { salvarAssociacaoOpcionais } from "@/lib/actions/opcional";
import { enviarFotoProduto } from "@/lib/actions/upload";
import { ProdutosClient } from "./ProdutosClient";

/**
 * Página de gestão de produtos do lojista (issue 044). Server Component.
 *
 * Todo o I/O usa o client AUTENTICADO — a RLS (`produtos_leitura_propria` /
 * `categorias`) isola por dono. `loja_id` é derivado da loja do dono, nunca de
 * input do cliente. Sem loja → redireciona ao onboarding/perfil. As mutações
 * acontecem via Server Actions (issue 031) disparadas pelo `ProdutosClient`.
 */
export default async function ProdutosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  // `buscarOpcionaisPorCategoria` precisa dos ids já resolvidos de
  // `buscarCategorias`, então as duas rodam em sequência dentro do mesmo ramo do
  // `Promise.all`, preservando o paralelismo com `buscarProdutosDoLojista`.
  const [produtos, { categorias, opcionaisPorCategoria }, categoriasOpcional] =
    await Promise.all([
      buscarProdutosDoLojista(supabase, loja.id),
      (async () => {
        const categorias = await buscarCategorias(supabase, loja.id);
        const opcionaisPorCategoria = await buscarOpcionaisPorCategoria(
          supabase,
          categorias.map((c) => c.id),
        );
        return { categorias, opcionaisPorCategoria };
      })(),
      buscarCategoriasOpcional(supabase, loja.id),
    ]);

  return (
    <ProdutosClient
      lojaSlug={loja.slug}
      lojaId={loja.id}
      produtos={produtos}
      categorias={categorias.map((c) => ({
        id: c.id,
        nome: c.nome,
        exibir_imagens: c.exibir_imagens,
      }))}
      opcionaisPorCategoria={opcionaisPorCategoria}
      categoriasOpcional={categoriasOpcional.map((c) => ({
        id: c.id,
        nome: c.nome,
      }))}
      // Actions do LOJISTA passadas explicitamente (issue 160): `acoes` é
      // obrigatória, sem default — a via admin injeta as variantes por `lojaId`.
      acoes={{
        removerProduto,
        alternarDisponibilidade,
        alternarOculto,
        criarProduto,
        atualizarProduto,
        enviarFotoProduto,
        criarCategoria,
        atualizarCategoria,
        removerCategoria,
        alternarExibirImagens,
        reordenarCategorias,
        salvarAssociacaoOpcionais,
      }}
    />
  );
}
