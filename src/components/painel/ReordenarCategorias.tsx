"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * O estado local reordena ANTES da rede. A referência para reverter é a última
 * ordem CONFIRMADA PELO SERVIDOR, não a do passo anterior: senão 4 toques com
 * falha no 4º voltariam só um passo e deixariam a lista num estado que nunca
 * existiu no banco.
 *
 * Toques rápidos são coalescidos por debounce e cada chamada leva a SEQUÊNCIA
 * COMPLETA de ids (nunca um delta) — é isso que cumpre "uma única ida ao banco
 * por operação". A coalescência é otimização, não invariante: como a RPC é
 * idempotente, N chamadas convergem para a mesma ordem. O que É invariante é o
 * guard de resposta obsoleta (`sequenciaRef`): sem ele uma resposta atrasada
 * reverteria a lista para um estado velho.
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

export type ReordenarCategoriasProps = {
  /** TODAS as categorias da loja, na ordem atual. Inclui as vazias. */
  categorias: Categoria[];
  /** `categoria_id → nº de produtos`. Ausente = 0. */
  contagemPorCategoria: Record<string, number>;
  /** Existem produtos sem categoria? Se sim, o grupo sintético aparece no fim. */
  temSemCategoria: boolean;
  /** Action injetável (a via admin passa a variante escopada). */
  onReordenar?: typeof reordenarCategoriasLojista;
};

export function ReordenarCategorias({
  categorias,
  contagemPorCategoria,
  temSemCategoria,
  onReordenar,
}: ReordenarCategoriasProps) {
  const reordenar = onReordenar ?? reordenarCategoriasLojista;

  const [ordem, setOrdem] = useState<Categoria[]>(categorias);
  const [mensagemViva, setMensagemViva] = useState(
    `Modo reordenar ativado. ${categorias.length} categorias. ` +
      "Use os botões mover para cima e mover para baixo.",
  );
  const [status, setStatus] = useState<"" | "salvando" | "salvo">("");
  const [idArrastando, setIdArrastando] = useState<string | null>(null);

  // Última ordem CONFIRMADA pelo servidor — o alvo da reversão em falha.
  const confirmadaRef = useRef<Categoria[]>(categorias);
  // Número de série do disparo: resposta cujo número não é o mais recente é
  // descartada (guard de resposta obsoleta).
  const sequenciaRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lido pelos `announcements` do dnd-kit e pelos handlers, que capturariam um
  // `ordem` velho. Sincronizado em efeito (escrever ref durante o render é
  // proibido): o efeito passivo é liberado antes do próximo evento discreto,
  // então todo handler de clique/arrasto já lê o valor recém-commitado.
  const ordemRef = useRef<Categoria[]>(categorias);
  useEffect(() => {
    ordemRef.current = ordem;
  }, [ordem]);

  // Timer pendente ao desmontar (ex.: "Concluir") não pode disparar depois.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const salvar = useCallback(
    async (proxima: Categoria[], seq: number) => {
      const anterior = confirmadaRef.current;
      const resultado = await reordenar(proxima.map((c) => c.id));
      // Resposta obsoleta: um disparo mais novo já está em voo.
      if (seq !== sequenciaRef.current) return;

      if (!resultado.ok) {
        setOrdem(anterior);
        setStatus("");
        setMensagemViva(
          "Não foi possível salvar a ordem. A lista voltou à ordem anterior.",
        );
        // Mensagem genérica vinda do servidor; o detalhe fica no log do servidor.
        toast.error(resultado.erro);
        return;
      }
      confirmadaRef.current = proxima;
      setStatus("salvo");
    },
    [reordenar],
  );

  const agendarSalvamento = useCallback(
    (proxima: Categoria[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus("salvando");
      timerRef.current = setTimeout(() => {
        const seq = ++sequenciaRef.current;
        void salvar(proxima, seq);
      }, DEBOUNCE_MS);
    },
    [salvar],
  );

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
      const proxima = moverPorDeslocamento(atual, de, para) as Categoria[];

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
      agendarSalvamento(proxima);
    },
    [agendarSalvamento],
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
