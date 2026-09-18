"use client";

import { useMemo, type Ref } from "react";

import {
  ModoReordenar,
  type ItemReordenavel,
  type ManipuladorModoReordenar,
} from "@/components/painel/ModoReordenar";
import type { reordenarOpcionaisDaCategoria as reordenarOpcionaisDaCategoriaLojista } from "@/lib/actions/opcional";

/**
 * Modo "Reordenar" dos grupos de opcional DENTRO de uma categoria de produto
 * (issue 209, sobre a Server Action da 208).
 *
 * Casca fina do `ModoReordenar`: o genérico só sabe mover itens e mandar a
 * sequência de ids; quem sabe que o payload desta feature leva `categoria_id`
 * junto é este arquivo. É por isso que ele existe em vez de reusar
 * `ReordenarCategorias` — a action tem outra forma de payload.
 *
 * ─────────────────────────────────────────── De onde a lista vem
 * `grupos` são SÓ os grupos marcados naquela categoria de produto, já ordenados
 * pelo pai a partir da `ordem` que veio do servidor (208). Nunca de estado local
 * sobrevivente: o componente é montado ao entrar no modo e desmontado ao sair, e
 * a saída faz `router.refresh()` — a ordem do servidor é a única fonte.
 *
 * ─────────────────────────────────────────── O que NÃO sai daqui
 * O cliente manda ids e nada mais. `ordem` é derivada de `ordinality - 1` dentro
 * da RPC, `loja_id` vem do `auth.uid()` (ou do escopo admin) no servidor, e a
 * permutação completa é conferida por `row_count` dentro da transação. O gate de
 * ≥2 itens no pai é UX; a autoridade é o `.min(2)` do zod na action.
 */

export type GrupoOpcionalReordenavel = {
  id: string;
  nome: string;
  totalItens: number;
};

export type ReordenarOpcionaisDaCategoriaProps = {
  /** Categoria de PRODUTO dona da lista. Vai no payload e é provada no servidor. */
  categoriaProdutoId: string;
  /** Grupos marcados, na ordem atual do servidor. */
  grupos: readonly GrupoOpcionalReordenavel[];
  /**
   * Action injetada. OBRIGATÓRIA (issue 160): sem default — a via admin passa a
   * variante escopada por `lojaId`, e omitir tem que quebrar o build em vez de
   * cair silenciosamente na action do lojista.
   */
  onReordenar: typeof reordenarOpcionaisDaCategoriaLojista;
  ref?: Ref<ManipuladorModoReordenar>;
};

export function ReordenarOpcionaisDaCategoria({
  categoriaProdutoId,
  grupos,
  onReordenar,
  ref,
}: ReordenarOpcionaisDaCategoriaProps) {
  const itens = useMemo<ItemReordenavel[]>(
    () =>
      grupos.map((g) => ({
        id: g.id,
        nome: g.nome,
        detalhe: `${g.totalItens} ${g.totalItens === 1 ? "item" : "itens"}`,
      })),
    [grupos],
  );

  return (
    <ModoReordenar
      ref={ref}
      itens={itens}
      mensagemInicial={
        `Modo reordenar ativado. ${grupos.length} grupos de opcional. ` +
        "Use os botões mover para cima e mover para baixo."
      }
      onReordenar={(ids) =>
        onReordenar({
          categoria_id: categoriaProdutoId,
          categoria_opcional_id: ids,
        })
      }
    />
  );
}
