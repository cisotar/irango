"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, Lock } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { LinhaCategoriaReordenavel } from "@/components/painel/LinhaCategoriaReordenavel";
import type { Categoria } from "@/components/painel/FormProduto";
import { reordenarCategorias as reordenarCategoriasLojista } from "@/lib/actions/produto";
import { moverPorDeslocamento, mensagemPosicao } from "@/lib/utils/reordenar";
import {
  criarSalvamentoCoalescido,
  type SalvamentoCoalescido,
  type StatusSalvamento,
} from "@/lib/utils/salvamento-coalescido";

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
 * ─────────────────────────────────────────── Otimismo e coalescência
 * O estado local reordena ANTES da rede. Debounce, ordem confirmada, fila e
 * flush moram em `criarSalvamentoCoalescido` (`lib/utils/salvamento-coalescido`),
 * fora da árvore React — é o que torna essas regras testáveis em
 * `environment: node`, já que `renderToStaticMarkup` não executa efeitos, não
 * dispara handlers e não avança timers. Este componente só liga a máquina ao
 * estado da tela.
 *
 * Cada chamada leva a SEQUÊNCIA COMPLETA de ids (nunca um delta) — é isso que
 * cumpre "uma única ida ao banco por operação" e o que permite à máquina
 * substituir o valor enfileirado pelo mais recente sem perda.
 *
 * ─────────────────────────────────────────── Saída do modo sem perder o último
 * movimento
 * Sair do modo (Concluir/ESC) precisa AGUARDAR o flush: o pai chama
 * `finalizar()` pelo `ref` e só então desmonta e faz `router.refresh()`. A ordem
 * importa — um flush disparado "para o ar" na desmontagem correria com o refresh
 * e o refresh venceria, trazendo a ordem antiga por cima do movimento recém-feito.
 * O flush na desmontagem continua existindo como ÚLTIMO RECURSO, para saídas que
 * não passam pelos botões do modo (navegação, por exemplo).
 *
 * ─────────────────────────────────────────── Sempre em modo reordenar
 * O componente não tem um `useState` de "ligado/desligado": quem o monta é o
 * pai. Isso é o que torna os cenários testáveis com `renderToStaticMarkup` —
 * não é preciso simular o clique que liga o modo, o que seria impossível sem
 * jsdom (o projeto roda vitest com `environment: node`).
 */

const DEBOUNCE_MS = 500;

/** Instruções do dnd-kit em pt-BR: o default em inglês vazaria ao leitor de tela. */
const INSTRUCOES_LEITOR: ScreenReaderInstructions = {
  draggable:
    "Pressione espaço para começar a arrastar. Use as setas para mover, " +
    "espaço para soltar e Escape para cancelar.",
};

/**
 * Handle imperativo do modo. Existe por um motivo só: o pai precisa AGUARDAR o
 * salvamento pendente antes de desmontar a lista e chamar `router.refresh()`.
 */
export type ManipuladorReordenarCategorias = {
  /** Resolve quando não há mais nada em voo nem na fila de salvamento. */
  finalizar: () => Promise<void>;
};

export type ReordenarCategoriasProps = {
  /** TODAS as categorias da loja, na ordem atual. Inclui as vazias. */
  categorias: Categoria[];
  /** `categoria_id → nº de produtos`. Ausente = 0. */
  contagemPorCategoria: Record<string, number>;
  /** Existem produtos sem categoria? Se sim, o grupo sintético aparece no fim. */
  temSemCategoria: boolean;
  /** Action injetável (a via admin passa a variante escopada). */
  onReordenar?: typeof reordenarCategoriasLojista;
  ref?: Ref<ManipuladorReordenarCategorias>;
};

export function ReordenarCategorias({
  categorias,
  contagemPorCategoria,
  temSemCategoria,
  onReordenar,
  ref,
}: ReordenarCategoriasProps) {
  const reordenar = onReordenar ?? reordenarCategoriasLojista;

  const [ordem, setOrdem] = useState<readonly Categoria[]>(categorias);
  const [mensagemViva, setMensagemViva] = useState(
    `Modo reordenar ativado. ${categorias.length} categorias. ` +
      "Use os botões mover para cima e mover para baixo.",
  );
  const [status, setStatus] = useState<StatusSalvamento>("");
  const [idArrastando, setIdArrastando] = useState<string | null>(null);

  // Lido pelos `announcements` do dnd-kit e pelos handlers, que capturariam um
  // `ordem` velho. Sincronizado em efeito (escrever ref durante o render é
  // proibido): o efeito passivo é liberado antes do próximo evento discreto,
  // então todo handler de clique/arrasto já lê o valor recém-commitado.
  const ordemRef = useRef<readonly Categoria[]>(categorias);
  useEffect(() => {
    ordemRef.current = ordem;
  }, [ordem]);

  /*
    Criada UMA vez, pelo inicializador preguiçoso de `useState`: recriá-la a cada
    render perderia o timer, a fila e a ordem confirmada. `useState` e não
    `useRef` de propósito — ler `ref.current` durante o render é proibido
    (react-hooks/refs), e aqui a máquina precisa estar disponível já no primeiro.
    Toda a regra está testada em `salvamento-coalescido.test.ts`; o que sobra
    aqui são só os efeitos de tela.

    `reordenar` e `categorias` são capturados no primeiro render de propósito: o
    componente é montado ao ENTRAR no modo e desmontado ao sair, e os dois pontos
    de chamada passam uma Server Action de módulo (identidade estável). A ordem
    inicial confirmada é, por definição, a que o servidor acabou de entregar.
  */
  const [salvamento] = useState<SalvamentoCoalescido<readonly Categoria[]>>(() =>
    criarSalvamentoCoalescido<readonly Categoria[]>({
      confirmada: categorias,
      atrasoMs: DEBOUNCE_MS,
      // O cliente manda SÓ a sequência de ids; `ordem` é derivada no servidor.
      salvar: (proxima) => reordenar(proxima.map((c) => c.id)),
      aoStatus: setStatus,
      // A reversão vai para a última ordem CONFIRMADA pelo servidor, não para a
      // do passo anterior: senão 4 toques com falha no 4º voltariam só um passo
      // e deixariam a lista num estado que nunca existiu no banco.
      aoFalhar: (confirmada, erro) => {
        setOrdem(confirmada);
        setMensagemViva(
          "Não foi possível salvar a ordem. A lista voltou à ordem anterior.",
        );
        // Mensagem genérica vinda da action; o detalhe fica no log do servidor.
        toast.error(erro);
      },
    }),
  );

  // O pai aguarda isto antes de desmontar e de chamar `router.refresh()`.
  useImperativeHandle(ref, () => ({ finalizar: () => salvamento.finalizar() }), [
    salvamento,
  ]);

  // ÚLTIMO RECURSO para saídas que não passam por Concluir/ESC (navegação, por
  // exemplo): dispara o pendente em vez de descartá-lo. Nos caminhos normais
  // isto já é no-op, porque o pai aguardou `finalizar()` antes de desmontar.
  useEffect(() => {
    return () => {
      void salvamento.finalizar();
    };
  }, [salvamento]);

  /**
   * Único caminho de escrita: ↑, ↓, "topo", "fim" e soltar o arrasto viram
   * todos o mesmo par (de, para). O arrasto é, por isso, camada de
   * APRESENTAÇÃO — não traz regra de negócio nem caminho de escrita novo.
   *
   * `anunciar = false` no arrasto: o dnd-kit já tem a própria região viva e
   * anuncia `onDragEnd`; escrever também na nossa duplicaria o anúncio.
   */
  const mover = useCallback(
    (de: number, para: number, anunciar = true) => {
      const atual = ordemRef.current;
      const categoria = atual[de];
      // moverPorDeslocamento já devolve readonly Categoria[] (T inferido de
      // `atual`); nenhum cast é necessário — ver tipos de estado acima.
      const proxima = moverPorDeslocamento(atual, de, para);

      // Mesma referência = no-op: NÃO escreve no banco (cenário 3) e a seta no
      // limite fica inerte (cenário 8). Uma regra só, sem `if` espalhado.
      if (proxima === atual) {
        if (anunciar && categoria) {
          setMensagemViva(
            para <= 0
              ? `${categoria.nome} já está na primeira posição.`
              : `${categoria.nome} já está na última posição.`,
          );
        }
        return;
      }

      setOrdem(proxima);
      if (anunciar && categoria) {
        setMensagemViva(
          mensagemPosicao(categoria.nome, proxima.indexOf(categoria), proxima.length),
        );
      }
      salvamento.agendar(proxima);
    },
    [salvamento],
  );

  // Com alça dedicada, `distance: 8` basta — não é preciso um TouchSensor com
  // janela de delay (que faria a tela parecer travada por 250ms).
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const posicaoDe = useCallback(
    (id: string) => ordemRef.current.findIndex((c) => c.id === id) + 1,
    [],
  );
  const nomeDe = useCallback(
    (id: string) => ordemRef.current.find((c) => c.id === id)?.nome ?? "",
    [],
  );

  /** Substitui os `announcements` do dnd-kit, que são em inglês por padrão. */
  const anuncios: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) =>
        `Arrastando ${nomeDe(String(active.id))}. Posição ${posicaoDe(
          String(active.id),
        )} de ${ordemRef.current.length}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${nomeDe(String(active.id))} será colocada na posição ${posicaoDe(
              String(over.id),
            )} de ${ordemRef.current.length}.`
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `${nomeDe(String(active.id))} movida para a posição ${posicaoDe(
              String(active.id),
            )} de ${ordemRef.current.length}.`
          : undefined,
      onDragCancel: ({ active }) =>
        `Arrasto cancelado. ${nomeDe(String(active.id))} continua na posição ${posicaoDe(
          String(active.id),
        )} de ${ordemRef.current.length}.`,
    }),
    [nomeDe, posicaoDe],
  );

  function aoComecarArrasto(evento: DragStartEvent) {
    setIdArrastando(String(evento.active.id));
  }

  function aoSoltar(evento: DragEndEvent) {
    setIdArrastando(null);
    const { active, over } = evento;
    if (!over) return;
    const atual = ordemRef.current;
    const de = atual.findIndex((c) => c.id === active.id);
    const para = atual.findIndex((c) => c.id === over.id);
    if (de < 0 || para < 0 || de === para) return; // soltar sobre si: zero escrita
    mover(de, para, false);
  }

  const ids = useMemo(() => ordem.map((c) => c.id), [ordem]);
  const arrastada = ordem.find((c) => c.id === idArrastando) ?? null;

  return (
    <div className="space-y-2">
      {/*
        Região viva ÚNICA do modo: `sr-only`, imóvel e FORA do `<ol>`. Nunca
        dentro do `<li>` que se move — um live region remontado ou reposicionado
        no DOM silencia ou duplica o anúncio (precedente: LinhaTempoStatus).
      */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {mensagemViva}
      </p>

      <Card>
        <CardContent className="p-0">
          <DndContext
            sensors={sensores}
            collisionDetection={closestCenter}
            accessibility={{
              announcements: anuncios,
              screenReaderInstructions: INSTRUCOES_LEITOR,
            }}
            onDragStart={aoComecarArrasto}
            onDragEnd={aoSoltar}
            onDragCancel={() => setIdArrastando(null)}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {/* `<ol>` semântico; `key` = id (por índice quebraria animação e foco). */}
              <ol className="motion-reduce:transition-none">
                {ordem.map((categoria, indice) => (
                  <LinhaCategoriaReordenavel
                    key={categoria.id}
                    id={categoria.id}
                    nome={categoria.nome}
                    totalProdutos={contagemPorCategoria[categoria.id] ?? 0}
                    indice={indice}
                    total={ordem.length}
                    onMover={mover}
                  />
                ))}

                {/*
                  "Sem categoria" é grupo SINTÉTICO do cliente: não existe linha
                  em `categorias`, não é ordenável e NUNCA entra no payload.
                  Fica fora do SortableContext, fixo no fim, SEM alça e SEM
                  setas — nem desabilitadas: nunca renderizar um controle que
                  não faz nada. Escondê-lo desorientaria; a regra precisa ser
                  ensinada, não escondida.
                */}
                {temSemCategoria && (
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
                )}
              </ol>
            </SortableContext>

            {/*
              DragOverlay em PORTAL: sem ele o `overflow` do Card clipa o item
              em movimento. `document` não existe no SSR (o projeto renderiza
              este componente com renderToStaticMarkup nos testes), daí o guard.
            */}
            {typeof document !== "undefined" &&
              createPortal(
                <DragOverlay>
                  {arrastada ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-2 shadow-lg motion-reduce:transform-none">
                      <span className="flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground">
                        <GripVertical aria-hidden className="size-4" />
                      </span>
                      <span className="line-clamp-1 text-sm font-medium text-foreground">
                        {arrastada.nome}
                      </span>
                    </div>
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
          </DndContext>
        </CardContent>
      </Card>

      {/*
        Status agregado, não um toast por movimento (uma chuva de notificações)
        nem um spinner por linha (a lista tremeria a cada toque).
        `aria-hidden`: a região viva acima já cobre o leitor de tela — duplicar
        causaria anúncio duplo.
      */}
      <p aria-hidden className="h-4 text-xs text-muted-foreground">
        {status === "salvando" && "Salvando ordem…"}
        {status === "salvo" && "Ordem salva"}
      </p>
    </div>
  );
}
