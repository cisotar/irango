"use client";

import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

/**
 * Arrasto de produto na listagem NORMAL do painel — sem entrar em modo nenhum.
 *
 * ─────────────────────────────────────────── Por que não é o `ModoReordenar`
 * Aquele componente é uma TELA: substitui a listagem por um `<ol>` de linhas
 * enxutas, guarda a ordem em estado próprio capturado na montagem e coalesce o
 * salvamento porque lá o lojista dispara muitos movimentos seguidos. Aqui a
 * listagem continua sendo a de sempre (thumb, badges, pílulas de dias, kebab),
 * a ordem exibida continua saindo das props do servidor e cada arrasto é UM
 * movimento. O botão "Reordenar" do cabeçalho — e o `ModoReordenar` atrás dele —
 * continua existindo para quem precisa de setas, "mover para o topo" e teclado
 * sem alça.
 *
 * ─────────────────────────────────────────── Um `DndContext` para a tela toda
 * Um contexto POR categoria colocaria na página uma região viva e um bloco de
 * instruções de leitor de tela por cartão. Então é um só, com um
 * `SortableContext` por grupo: a ordem de produto só existe DENTRO da categoria
 * (a RPC é escopada pelo par loja+categoria), e soltar num grupo diferente é
 * recusado por quem trata o evento — trocar de categoria é outra escrita.
 *
 * `id` fixo no `DndContext`: sem ele o `aria-describedby` das alças sai de um
 * contador de módulo do dnd-kit, que no servidor sobrevive entre requisições e
 * divergiria do valor gerado no browser na hidratação.
 */

/** 44px literais — `min-h-11` seria 52,8px na base de 120% (design-system §5). */
const ALVO_TOQUE = "min-h-[44px] min-w-[44px]";

/** Classes da linha do produto: o wrapper arrastável É a linha da listagem. */
const CLASSES_LINHA = "flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3";

/** Instruções do dnd-kit em pt-BR: o default em inglês vazaria ao leitor de tela. */
const INSTRUCOES_LEITOR: ScreenReaderInstructions = {
  draggable:
    "Pressione espaço para começar a arrastar. Use as setas para mover, " +
    "espaço para soltar e Escape para cancelar.",
};

/** Onde cada produto arrastável está, para os anúncios em pt-BR. */
export type PosicaoArrastavel = {
  nome: string;
  /** 1-based, DENTRO da categoria. */
  posicao: number;
  /** Total da categoria dele. */
  total: number;
};

export type ArrastoDeProdutosProps = {
  /**
   * Fora: nada de dnd-kit é montado. A tela sem nenhum grupo de dois produtos
   * (ou no modo de seleção) não ganha sensores nem instruções descrevendo um
   * gesto que não move nada.
   */
  ativo: boolean;
  /** `produto.id → posição`, já na ordem EXIBIDA. */
  posicoes: Record<string, PosicaoArrastavel>;
  /** Só é chamado com ids distintos; a recusa cross-categoria é de quem trata. */
  aoSoltar: (ativo: string, sobre: string) => void;
  children: ReactNode;
};

export function ArrastoDeProdutos({
  ativo,
  posicoes,
  aoSoltar,
  children,
}: ArrastoDeProdutosProps) {
  // Hooks moram no envelope: com `ativo` falso ele nem é montado, e nenhum
  // sensor, anúncio ou `<Accessibility>` do dnd-kit chega a existir.
  if (!ativo) return <>{children}</>;
  return (
    <EnvelopeArrasto posicoes={posicoes} aoSoltar={aoSoltar}>
      {children}
    </EnvelopeArrasto>
  );
}

function EnvelopeArrasto({
  posicoes,
  aoSoltar,
  children,
}: Omit<ArrastoDeProdutosProps, "ativo">) {
  const [idArrastando, setIdArrastando] = useState<string | null>(null);

  // Com alça dedicada, `distance: 8` basta — não é preciso um TouchSensor com
  // janela de delay (que faria a tela parecer travada por 250ms).
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Substitui os `announcements` do dnd-kit, que são em inglês por padrão.
   *
   * A posição de DESTINO é a do item sob o cursor (`over`) lida na ordem ANTES
   * do movimento — é exatamente o índice onde o arrastado vai parar, e ler a
   * posição do próprio arrastado aqui anunciaria a posição de origem, já que o
   * estado novo ainda não foi commitado quando o dnd-kit anuncia.
   */
  const anuncios: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => {
        const onde = posicoes[String(active.id)];
        return onde == null
          ? undefined
          : `Arrastando ${onde.nome}. Posição ${onde.posicao} de ${onde.total}.`;
      },
      onDragOver: ({ active, over }) => {
        const arrastado = posicoes[String(active.id)];
        const destino = over == null ? undefined : posicoes[String(over.id)];
        return arrastado == null || destino == null
          ? undefined
          : `${arrastado.nome} será colocado na posição ${destino.posicao} de ${destino.total}.`;
      },
      onDragEnd: ({ active, over }) => {
        const arrastado = posicoes[String(active.id)];
        const destino = over == null ? undefined : posicoes[String(over.id)];
        if (arrastado == null) return undefined;
        return destino == null
          ? `Arrasto cancelado. ${arrastado.nome} continua na posição ${arrastado.posicao} de ${arrastado.total}.`
          : `${arrastado.nome} movido para a posição ${destino.posicao} de ${destino.total}.`;
      },
      onDragCancel: ({ active }) => {
        const onde = posicoes[String(active.id)];
        return onde == null
          ? undefined
          : `Arrasto cancelado. ${onde.nome} continua na posição ${onde.posicao} de ${onde.total}.`;
      },
    }),
    [posicoes],
  );

  function comecar(evento: DragStartEvent) {
    setIdArrastando(String(evento.active.id));
  }

  function soltar(evento: DragEndEvent) {
    setIdArrastando(null);
    const { active, over } = evento;
    if (over == null || active.id === over.id) return;
    aoSoltar(String(active.id), String(over.id));
  }

  const arrastado = idArrastando == null ? null : posicoes[idArrastando];

  return (
    <DndContext
      id="arrasto-produtos"
      sensors={sensores}
      collisionDetection={closestCenter}
      accessibility={{
        announcements: anuncios,
        screenReaderInstructions: INSTRUCOES_LEITOR,
      }}
      onDragStart={comecar}
      onDragEnd={soltar}
      onDragCancel={() => setIdArrastando(null)}
    >
      {children}

      {/* DragOverlay em PORTAL: sem ele o `overflow` do Card clipa o item em
          movimento. `document` não existe no SSR (o projeto renderiza esta
          árvore com renderToStaticMarkup nos testes), daí o guard. */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay>
            {arrastado ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-2 shadow-lg motion-reduce:transform-none">
                <span className={`${ALVO_TOQUE} flex items-center justify-center text-muted-foreground`}>
                  <GripVertical aria-hidden className="size-4" />
                </span>
                <span className="line-clamp-1 text-sm font-medium text-foreground">
                  {arrastado.nome}
                </span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

export type GrupoArrastavelProps = {
  /** Grupo com menos de dois produtos não tem ordem a escolher. */
  ativo: boolean;
  /** Ids dos produtos DESTE grupo, na ordem exibida. */
  ids: string[];
  children: ReactNode;
};

/**
 * Um `SortableContext` por categoria. Não emite markup: o `divide-y` do
 * `CardContent` continua separando as linhas como antes.
 */
export function GrupoArrastavel({ ativo, ids, children }: GrupoArrastavelProps) {
  if (!ativo) return <>{children}</>;
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

export type LinhaProdutoArrastavelProps = {
  id: string;
  /** Só para a `aria-label` da alça. */
  nome: string;
  /** Fora do grupo ordenável (ou modo de seleção): linha comum, sem alça. */
  arrastavel: boolean;
  /** Ordem deste grupo em voo: a alça fica inerte, nunca `disabled`. */
  bloqueado?: boolean;
  children: ReactNode;
};

export function LinhaProdutoArrastavel({
  id,
  nome,
  arrastavel,
  bloqueado = false,
  children,
}: LinhaProdutoArrastavelProps) {
  // `useSortable` não pode ser condicional, e a linha não-arrastável tem que
  // sair com o MESMO markup de antes — daí o componente interno.
  if (!arrastavel) return <div className={CLASSES_LINHA}>{children}</div>;
  return (
    <LinhaSortable id={id} nome={nome} bloqueado={bloqueado}>
      {children}
    </LinhaSortable>
  );
}

function LinhaSortable({
  id,
  nome,
  bloqueado,
  children,
}: Omit<LinhaProdutoArrastavelProps, "arrastavel"> & { bloqueado: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // O slot de origem vira placeholder de MESMA ALTURA (nunca colapsa a
      // zero, senão a lista pularia sob o dedo); quem segue o cursor é o
      // DragOverlay.
      className={
        isDragging
          ? `${CLASSES_LINHA} border-2 border-dashed bg-muted/40 [&>*]:opacity-0`
          : CLASSES_LINHA
      }
    >
      {/* Alça dedicada: `touch-action: none` fica confinado a 44×44px, então o
          resto da página continua rolando normalmente no toque. Arrastar a
          linha inteira exigiria matar o scroll na área útil da listagem. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...(bloqueado ? {} : listeners)}
        style={{ touchAction: "none" }}
        aria-label={`Reordenar ${nome}`}
        // Só sobrescreve quando bloqueado: `undefined` apagaria o
        // `aria-disabled="false"` que o spread do `useSortable` já emite.
        {...(bloqueado ? { "aria-disabled": true as const } : {})}
        className={`${ALVO_TOQUE} flex shrink-0 cursor-grab items-center justify-center self-start rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing`}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      {children}
    </div>
  );
}
