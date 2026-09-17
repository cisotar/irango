"use client";

import { useMemo, type Ref } from "react";
import { Lock } from "lucide-react";

import {
  ModoReordenar,
  type ItemReordenavel,
  type ManipuladorModoReordenar,
} from "@/components/painel/ModoReordenar";
import type { Categoria } from "@/components/painel/FormProduto";
import type { reordenarCategorias as reordenarCategoriasLojista } from "@/lib/actions/produto";

/**
 * Modo "Reordenar categorias" (issue 175).
 *
 * ─────────────────────────────────────────── De onde a lista vem
 * Lê SEMPRE de `categorias` (todas, já ordenadas por `buscarCategorias`),
 * NUNCA de `grupos`: `ProdutosClient` filtra categorias vazias da listagem
 * normal, e reordenar sobre esse subconjunto teria três defeitos — o lojista
 * não conseguiria posicionar a categoria recém-criada (que nasce vazia),
 * normalizar 0..n−1 sobre um subconjunto REINTRODUZIRIA o empate de `ordem`
 * que a feature existe para matar, e o "posição X de N" mentiria.
 *
 * ─────────────────────────────────────────── O que sobrou aqui (issue 209)
 * Tudo que é genérico — otimismo, coalescência, anúncios em pt-BR, a saída do
 * modo sem perder o último movimento — mudou-se para `ModoReordenar`, que a 209
 * passou a compartilhar com os grupos de opcional. Este arquivo ficou com o que
 * é SÓ de categoria de produto: a contagem singularizada, a mensagem de entrada
 * e o grupo sintético "Sem categoria". O markup resultante é o mesmo de antes —
 * `ReordenarCategorias.test.tsx` (13 casos) roda sem uma linha de edição.
 */

/** Alias mantido para não tocar `ProdutosClient` (o handle é o mesmo). */
export type ManipuladorReordenarCategorias = ManipuladorModoReordenar;

export type ReordenarCategoriasProps = {
  /** TODAS as categorias da loja, na ordem atual. Inclui as vazias. */
  categorias: Categoria[];
  /** `categoria_id → nº de produtos`. Ausente = 0. */
  contagemPorCategoria: Record<string, number>;
  /** Existem produtos sem categoria? Se sim, o grupo sintético aparece no fim. */
  temSemCategoria: boolean;
  /**
   * Action injetada. OBRIGATÓRIA (issue 160): o `ProdutosClient` repassa
   * `acoes.reordenarCategorias` — do lojista na page do painel, escopada por
   * `lojaId` na via admin. Sem default.
   */
  onReordenar: typeof reordenarCategoriasLojista;
  ref?: Ref<ManipuladorReordenarCategorias>;
};

export function ReordenarCategorias({
  categorias,
  contagemPorCategoria,
  temSemCategoria,
  onReordenar,
  ref,
}: ReordenarCategoriasProps) {
  // `useMemo` com `categorias` na dependência por higiene; na prática o
  // componente é montado ao entrar no modo e desmontado ao sair, e o
  // `ModoReordenar` captura a lista inicial no primeiro render.
  const itens = useMemo<ItemReordenavel[]>(
    () =>
      categorias.map((c) => {
        const total = contagemPorCategoria[c.id] ?? 0;
        return {
          id: c.id,
          nome: c.nome,
          // 0 é legítimo e só aparece neste modo (cenário 10).
          detalhe: `${total} ${total === 1 ? "produto" : "produtos"}`,
        };
      }),
    [categorias, contagemPorCategoria],
  );

  return (
    <ModoReordenar
      ref={ref}
      itens={itens}
      mensagemInicial={
        `Modo reordenar ativado. ${categorias.length} categorias. ` +
        "Use os botões mover para cima e mover para baixo."
      }
      // O cliente manda SÓ a sequência de ids; `ordem` é derivada no servidor.
      onReordenar={(ids) => onReordenar(ids)}
      rodape={
        /*
          "Sem categoria" é grupo SINTÉTICO do cliente: não existe linha
          em `categorias`, não é ordenável e NUNCA entra no payload.
          Fica fora do SortableContext, fixo no fim, SEM alça e SEM
          setas — nem desabilitadas: nunca renderizar um controle que
          não faz nada. Escondê-lo desorientaria; a regra precisa ser
          ensinada, não escondida.
        */
        temSemCategoria ? (
          <li className="flex items-center gap-2 border-t border-border px-2 py-2 text-muted-foreground">
            <span className="flex min-h-[44px] min-w-[44px] items-center justify-center">
              <Lock aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="line-clamp-1 text-sm font-medium">
                Sem categoria
              </span>
              <span className="text-xs">Sempre por último</span>
            </div>
          </li>
        ) : undefined
      }
    />
  );
}
