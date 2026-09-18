"use client";

import { useMemo, type ReactNode, type Ref } from "react";

import {
  ModoReordenar,
  type ItemReordenavel,
  type ManipuladorModoReordenar,
} from "@/components/painel/ModoReordenar";
import type { StatusSalvamento } from "@/lib/utils/salvamento-coalescido";
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
 * sobrevivente: desde a 213 o cartão REMONTA esta lista (via `key`) sempre que o
 * conjunto de marcados muda, e cada toggle faz `router.refresh()` — a ordem do
 * servidor continua sendo a única fonte.
 *
 * ─────────────────────────────────────────── Por que só os MARCADOS entram
 * Os desmarcados ficam num segmento separado do cartão, FORA do `SortableContext`
 * (213). Numa lista única o `closestCenter` do dnd-kit aceitaria soltar na região
 * dos desmarcados e produziria posição para um grupo SEM linha em
 * `categoria_produto_opcionais`; a RPC confere `row_count` e derrubaria a
 * transação.
 *
 * ─────────────────────────────────────────── O que NÃO sai daqui
 * O cliente manda ids e nada mais. `ordem` é derivada de `ordinality - 1` dentro
 * da RPC, `loja_id` vem do `auth.uid()` (ou do escopo admin) no servidor, e a
 * permutação completa é conferida por `row_count` dentro da transação. Com menos
 * de 2 grupos não existe movimento possível na tela, e a autoridade continua
 * sendo o `.min(2)` do zod na action.
 */

export type GrupoOpcionalReordenavel = {
  id: string;
  nome: string;
  totalItens: number;
  /** Slot antes da alça — o checkbox "incluir/remover" do cartão (213). */
  prefixo?: ReactNode;
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
  /** Lista embutida no cartão do chamador: sem `<Card>` próprio (213). */
  semCartao?: boolean;
  /** O cartão mostra UM status agregado; este fica escondido (213). */
  ocultarStatus?: boolean;
  /** Espelha o status da ordem para o cartão agregá-lo com o da associação. */
  aoMudarStatus?: (status: StatusSalvamento) => void;
  /** Toggle de checkbox em voo: alça e setas inertes (nunca `disabled`). */
  arrastoBloqueado?: boolean;
  ref?: Ref<ManipuladorModoReordenar>;
};

export function ReordenarOpcionaisDaCategoria({
  categoriaProdutoId,
  grupos,
  onReordenar,
  semCartao,
  ocultarStatus,
  aoMudarStatus,
  arrastoBloqueado,
  ref,
}: ReordenarOpcionaisDaCategoriaProps) {
  const itens = useMemo<ItemReordenavel[]>(
    () =>
      grupos.map((g) => ({
        id: g.id,
        nome: g.nome,
        detalhe: `${g.totalItens} ${g.totalItens === 1 ? "item" : "itens"}`,
        prefixo: g.prefixo,
      })),
    [grupos],
  );

  return (
    <ModoReordenar
      ref={ref}
      itens={itens}
      semCartao={semCartao}
      ocultarStatus={ocultarStatus}
      aoMudarStatus={aoMudarStatus}
      arrastoBloqueado={arrastoBloqueado}
      mensagemInicial={
        `${grupos.length} grupos de opcional na ordem da vitrine. ` +
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
