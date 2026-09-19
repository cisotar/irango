"use client";

import { useMemo, type ReactNode, type Ref } from "react";

import {
  ModoReordenar,
  type ContextoLinhaReordenavel,
  type ItemReordenavel,
  type ManipuladorModoReordenar,
} from "@/components/painel/ModoReordenar";
import type { StatusSalvamento } from "@/lib/utils/salvamento-coalescido";
import type { reordenarItensDoGrupoOpcional as reordenarItensDoGrupoOpcionalLojista } from "@/lib/actions/opcional";

/**
 * Modo "Reordenar" dos ITENS dentro de UM grupo de opcional (issue 216, sobre a
 * RPC e a Server Action da 215).
 *
 * Casca fina do `ModoReordenar`, irmã de `ReordenarOpcionaisDaCategoria` um
 * nível abaixo na árvore: lá a sequência é de GRUPOS dentro de uma categoria de
 * PRODUTO e o payload leva `categoria_id`; aqui é de ITENS dentro de um GRUPO e
 * o payload leva `{ categoria_opcional_id, opcional_id }`. A forma do payload é
 * OUTRA — é exatamente por isso que existem duas cascas e não um alias.
 *
 * ─────────────────────────────────────────── Sem arrasto, e não é preguiça
 * Esta lista vive DENTRO da lista de grupos, que já é arrastável: uma alça aqui
 * seria `DndContext` dentro de `DndContext`, com o `pointerdown` da alça interna
 * borbulhando para o sensor externo. Além disso não há Playwright nem MCP de
 * browser nesta máquina (issue 176), então gesto de toque não é testável por
 * agente nenhum — setas e teclado são. `semArrasto` faz o `ModoReordenar` não
 * montar o contexto, o que também elimina as instruções de arrasto do dnd-kit
 * (que descreveriam uma alça inexistente) e a terceira `aria-live` da tela.
 *
 * ─────────────────────────────────────────── O que NÃO sai daqui
 * O cliente manda ids e nada mais. `ordem` é derivada de `ordinality - 1` dentro
 * da RPC, `loja_id` vem de `auth.uid()` (ou do escopo admin) no servidor, e a
 * permutação COMPLETA do par (loja, grupo) — inativos incluídos — é conferida
 * por `row_count` dentro da transação. Com 1 item não há movimento possível na
 * tela, e a autoridade continua sendo o `.min(2)` do zod na action.
 */

/** O mínimo que a lista precisa saber de um item para ordená-lo. */
export type ItemDoGrupoReordenavel = {
  id: string;
  nome: string;
};

export type ReordenarItensDoGrupoProps = {
  /** Grupo de opcional dono da lista. Vai no payload e é provado no servidor. */
  grupoId: string;
  grupoNome: string;
  /** TODOS os itens do grupo — ativos e inativos —, na ordem do servidor. */
  itens: readonly ItemDoGrupoReordenavel[];
  /**
   * Action injetada. OBRIGATÓRIA (issue 160): sem default — a via admin passa a
   * variante escopada por `lojaId`, e omitir tem que quebrar o build em vez de
   * cair silenciosamente na action do lojista.
   */
  onReordenar: typeof reordenarItensDoGrupoOpcionalLojista;
  /** Como desenhar a linha (é o painel quem conhece os estados dela). */
  renderLinha: (ctx: ContextoLinhaReordenavel) => ReactNode;
  /** Espelha o status da ordem para o cartão agregá-lo com os outros. */
  aoMudarStatus?: (status: StatusSalvamento) => void;
  /** Mutação do painel em voo: as setas ficam inertes (nunca `disabled`). */
  arrastoBloqueado?: boolean;
  ref?: Ref<ManipuladorModoReordenar>;
};

export function ReordenarItensDoGrupo({
  grupoId,
  grupoNome,
  itens,
  onReordenar,
  renderLinha,
  aoMudarStatus,
  arrastoBloqueado,
  ref,
}: ReordenarItensDoGrupoProps) {
  const itensReordenaveis = useMemo<ItemReordenavel[]>(
    () => itens.map((i) => ({ id: i.id, nome: i.nome })),
    [itens],
  );

  return (
    <ModoReordenar
      ref={ref}
      itens={itensReordenaveis}
      semCartao
      ocultarStatus
      semArrasto
      renderLinha={renderLinha}
      aoMudarStatus={aoMudarStatus}
      arrastoBloqueado={arrastoBloqueado}
      // NÃO menciona arrastar: não há alça, e prometer um gesto inexistente é
      // bug de acessibilidade, não detalhe de copy.
      mensagemInicial={
        `${itens.length} ${itens.length === 1 ? "opcional" : "opcionais"} ` +
        `no grupo ${grupoNome}, na ordem da vitrine. ` +
        "Use os botões mover para cima e mover para baixo."
      }
      onReordenar={(ids) =>
        onReordenar({ categoria_opcional_id: grupoId, opcional_id: ids })
      }
    />
  );
}
