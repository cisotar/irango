"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  GripVertical,
  MoreVertical,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";

/**
 * Uma linha (`<li>`) da lista do modo reordenar (issue 175).
 *
 * `useSortable` PRECISA morar no item (não no container), por isso este
 * componente existe separado de `ReordenarCategorias`.
 *
 * Duas armadilhas de a11y que este arquivo trava (mockup §7):
 *
 *  1. **Limites usam `aria-disabled` + `onClick` no-op, NUNCA `disabled`.** O
 *     `disabled` real remove o botão da ordem de foco: ao mover um item para o
 *     topo, o foco estaria no `↑` que acaba de desabilitar e se perderia para o
 *     `<body>`. Esse é o bug nº 1 deste padrão. O clique continua chamando
 *     `onMover`, que vira no-op em `moverPorDeslocamento` (mesma referência).
 *  2. **Alvos de 44px LITERAIS.** `min-h-11` seria 2.75rem = 52,8px na base de
 *     120% do projeto (globals.css) e `size="icon-sm"` do shadcn é `size-7` =
 *     33,6px — proibido aqui.
 *
 * A `aria-label` NÃO inclui a posição: ela mudaria a cada render e provocaria
 * re-anúncio. A posição é anunciada uma vez, pela região viva do pai.
 */

/** 44px literal em alvo de toque — ver comentário acima. */
const ALVO_TOQUE = "min-h-[44px] min-w-[44px]";

export type LinhaCategoriaReordenavelProps = {
  id: string;
  nome: string;
  /** Quantos produtos a categoria tem (0 é legítimo e só aparece neste modo). */
  totalProdutos: number;
  /** Índice 0-based na lista atual. */
  indice: number;
  total: number;
  /** Recebe (de, para). O clamp/no-op é do `moverPorDeslocamento` no pai. */
  onMover: (de: number, para: number) => void;
};

export function LinhaCategoriaReordenavel({
  id,
  nome,
  totalProdutos,
  indice,
  total,
  onMover,
}: LinhaCategoriaReordenavelProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const noTopo = indice === 0;
  const noFim = indice === total - 1;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // O slot de origem vira placeholder de MESMA ALTURA (nunca colapsa a
      // zero, senão a lista pularia sob o dedo); quem segue o cursor é o
      // DragOverlay do pai.
      className={
        "flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0 " +
        (isDragging
          ? "rounded-lg border-2 border-dashed bg-muted/40 [&>*]:opacity-0"
          : "bg-background")
      }
    >
      {/* Alça dedicada: `touch-action: none` fica confinado a 44×44px, então o
          resto da página continua rolando normalmente no toque. Arrastar o card
          inteiro exigiria matar o scroll na área útil da página. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        style={{ touchAction: "none" }}
        aria-label={`Reordenar ${nome}`}
        className={`${ALVO_TOQUE} flex cursor-grab items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing`}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>

      {/* A posição numérica é VISÍVEL: sem ela, "deslocamento" e "troca" ficam
          indistinguíveis para quem só olha o resultado. */}
      <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
        {indice + 1}.
      </span>

      <div className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-foreground">
          {nome}
        </span>
        <span className="text-xs text-muted-foreground">
          {totalProdutos} {totalProdutos === 1 ? "produto" : "produtos"}
        </span>
      </div>

      {/* gap-2: dois alvos de 44px encostados convidam ao toque errado. */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className={ALVO_TOQUE}
          aria-label={`Mover ${nome} para cima`}
          aria-disabled={noTopo}
          onClick={() => onMover(indice, indice - 1)}
        >
          <ArrowUp aria-hidden className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={ALVO_TOQUE}
          aria-label={`Mover ${nome} para baixo`}
          aria-disabled={noFim}
          onClick={() => onMover(indice, indice + 1)}
        >
          <ArrowDown aria-hidden className="size-4" />
        </Button>

        {/* Resolve o pior caso (última → primeira) em 1 toque, em vez de N. */}
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={ALVO_TOQUE}
                aria-label={`Mais ações de ${nome}`}
              />
            }
          >
            <MoreVertical aria-hidden className="size-4" />
          </MenuTrigger>
          <MenuPortal>
            <MenuPositioner align="end">
              <MenuPopup>
                <MenuItem
                  className="min-h-[44px]"
                  aria-disabled={noTopo}
                  onClick={() => onMover(indice, 0)}
                >
                  <ChevronsUp aria-hidden className="size-4" />
                  Mover para o topo
                </MenuItem>
                <MenuItem
                  className="min-h-[44px]"
                  aria-disabled={noFim}
                  onClick={() => onMover(indice, total - 1)}
                >
                  <ChevronsDown aria-hidden className="size-4" />
                  Mover para o fim
                </MenuItem>
              </MenuPopup>
            </MenuPositioner>
          </MenuPortal>
        </Menu>
      </div>
    </li>
  );
}
