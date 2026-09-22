"use client";

import { useMemo, type Ref } from "react";

import {
  ModoReordenar,
  type ItemReordenavel,
  type ManipuladorModoReordenar,
} from "@/components/painel/ModoReordenar";
import type { Produto } from "@/lib/supabase/queries/produtos";
import type { reordenarProdutos as reordenarProdutosLojista } from "@/lib/actions/produto";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

/**
 * Modo "Reordenar produtos" (issue 293) — irmão do `ReordenarCategorias`.
 *
 * ─────────────────────────────────────────── Escopo: UMA categoria por vez
 * A ordem dos produtos só existe DENTRO do grupo (a listagem do painel e a
 * vitrine agrupam por categoria e ordenam por `ordem` dentro do grupo), e a RPC
 * `reordenar_produtos` é escopada pelo PAR (loja, categoria). Reordenar "todos
 * os produtos da loja" inventaria uma semântica de ordem global que o schema
 * não tem — daí o modo nascer do cabeçalho da categoria, não da barra do topo.
 *
 * `categoriaId` é `null` para o grupo "Sem categoria" (`categoria_id IS NULL`),
 * que É um grupo reordenável de verdade aqui — diferente do modo de
 * CATEGORIAS, onde ele é só um rótulo sintético fixo no fim da lista.
 *
 * ─────────────────────────────────────────── O que NÃO mora aqui
 * Otimismo, coalescência de salvamento, anúncios em pt-BR, arrasto e a saída do
 * modo sem perder o último movimento são todos do `ModoReordenar` (issue 209),
 * que já serve categorias, grupos de opcional e itens de grupo. Este arquivo só
 * projeta produto → `ItemReordenavel` e monta o payload da action.
 */

/** Alias por simetria com `ManipuladorReordenarCategorias` — o handle é o mesmo. */
export type ManipuladorReordenarProdutos = ManipuladorModoReordenar;

export type ReordenarProdutosProps = {
  /** Os produtos DESTE grupo, na ordem atual (já filtrados pelo pai). */
  produtos: Produto[];
  /** Categoria do grupo. `null` = "Sem categoria" (`categoria_id IS NULL`). */
  categoriaId: string | null;
  /** Nome do grupo, só para a frase da região viva. */
  nomeCategoria: string;
  /**
   * Action injetada, OBRIGATÓRIA (issue 160): a page do painel passa a do
   * lojista, a via admin passa a variante escopada por `lojaId`. Sem default —
   * cair na do lojista no hub admin gravaria na loja errada.
   */
  onReordenar: typeof reordenarProdutosLojista;
  ref?: Ref<ManipuladorReordenarProdutos>;
};

export function ReordenarProdutos({
  produtos,
  categoriaId,
  nomeCategoria,
  onReordenar,
  ref,
}: ReordenarProdutosProps) {
  const itens = useMemo<ItemReordenavel[]>(
    () =>
      produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        // O preço é o que distingue duas linhas de nome parecido ("X-Burguer" /
        // "X-Burguer duplo") na hora de arrastar. Apresentação pura: nenhum
        // valor monetário sai daqui para o servidor.
        detalhe: formatarMoeda(p.preco),
      })),
    [produtos],
  );

  return (
    <ModoReordenar
      ref={ref}
      itens={itens}
      mensagemInicial={
        `Modo reordenar ativado. ${produtos.length} produtos em ${nomeCategoria}. ` +
        "Use os botões mover para cima e mover para baixo."
      }
      // O cliente manda SÓ a sequência de ids e a categoria do grupo; `ordem` e
      // `loja_id` são derivados no SERVIDOR.
      onReordenar={(ids) =>
        onReordenar({ categoria_id: categoriaId, produto_ids: ids })
      }
    />
  );
}
