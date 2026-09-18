"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
import { GripVertical } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { LinhaCategoriaReordenavel } from "@/components/painel/LinhaCategoriaReordenavel";
import { moverPorDeslocamento, mensagemPosicao } from "@/lib/utils/reordenar";
import {
  criarSalvamentoCoalescido,
  type ResultadoSalvamento,
  type SalvamentoCoalescido,
  type StatusSalvamento,
} from "@/lib/utils/salvamento-coalescido";

/**
 * Miolo GENÉRICO do modo reordenar (extraído de `ReordenarCategorias` na issue
 * 209, entregue na 175).
 *
 * ─────────────────────────────────────────── Por que este arquivo existe
 * A acessibilidade em pt-BR (região viva única, anúncios do dnd-kit, limites por
 * `aria-disabled`, alvos de 44px) e a coalescência de salvamento somam ~250
 * linhas que NÃO têm nada de específico de categoria de produto. Duplicá-las
 * para os grupos de opcional (209) seria duplicar exatamente o tipo de código
 * que o mandato "não reinventar a roda" existe para evitar — e a segunda cópia
 * envelheceria sozinha. Quem sabe o que é uma categoria, um grupo de opcional ou
 * um payload de action é o CHAMADOR; aqui só existe "item com id e nome".
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
 * substituir o valor enfileirado pelo mais recente sem perda. `ordem` NUNCA sai
 * do cliente: ela é derivada do índice dentro do servidor.
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

/** O mínimo que uma linha arrastável precisa. `detalhe` é a 2ª linha de texto. */
export type ItemReordenavel = {
  id: string;
  nome: string;
  detalhe?: string;
  /** Slot antes da alça (issue 213 — o checkbox do cartão de associação). */
  prefixo?: ReactNode;
};

/**
 * O que `renderLinha` recebe por item. `item` é o dado genérico; quem precisa de
 * conteúdo específico (preço, badge, estado de edição) o resolve olhando
 * `item.id` nos PRÓPRIOS mapas — por isso `ItemReordenavel` não cresce.
 */
export type ContextoLinhaReordenavel = {
  item: ItemReordenavel;
  indice: number;
  total: number;
  /** Salvamento do pai em voo: a linha deixa os controles inertes. */
  bloqueado: boolean;
  /** Único caminho de escrita: (de, para). O clamp/no-op é do pai. */
  onMover: (de: number, para: number) => void;
};

/**
 * Handle imperativo do modo. Existe por um motivo só: o pai precisa AGUARDAR o
 * salvamento pendente antes de desmontar a lista e chamar `router.refresh()`.
 */
export type ManipuladorModoReordenar = {
  /** Resolve quando não há mais nada em voo nem na fila de salvamento. */
  finalizar: () => Promise<void>;
  /**
   * Escreve na região viva ÚNICA deste modo (issue 213). Existe para que o pai
   * anuncie um evento que não é um movimento — marcar/desmarcar um grupo — sem
   * criar uma segunda `aria-live` na mesma tela, que silenciaria ou duplicaria
   * o anúncio.
   */
  anunciar: (mensagem: string) => void;
};

export type ModoReordenarProps = {
  /** Itens na ordem atual, já filtrados e ordenados pelo pai. */
  itens: readonly ItemReordenavel[];
  /**
   * Recebe a SEQUÊNCIA COMPLETA de ids, nunca um delta e nunca um número de
   * `ordem`. Quem monta o payload da Server Action é o chamador — é lá que mora
   * o conhecimento de qual action é a do lojista e qual é a escopada por loja.
   */
  onReordenar: (ids: string[]) => Promise<ResultadoSalvamento>;
  /** Primeira frase da região viva, ex.: "Modo reordenar ativado. 3 categorias. …" */
  mensagemInicial: string;
  /** Linha fixa NÃO ordenável no fim do `<ol>` (hoje só o "Sem categoria"). */
  rodape?: ReactNode;
  /**
   * Lista já embutida em outro cartão: dispensa o `<Card>` próprio. Default
   * `false` — o markup de quem já usava o componente não muda um byte.
   */
  semCartao?: boolean;
  /** Quem mostra o status é o pai (status AGREGADO do cartão, issue 213). */
  ocultarStatus?: boolean;
  /** Espelha o status para o pai poder agregá-lo com o dele. */
  aoMudarStatus?: (status: StatusSalvamento) => void;
  /** Salvamento do pai em voo: alça e setas ficam inertes (nunca `disabled`). */
  arrastoBloqueado?: boolean;
  /**
   * Lista SEM arrasto: só setas/kebab (issue 216). NÃO confundir com
   * `arrastoBloqueado`, que deixa alça E setas inertes — aqui as setas
   * continuam funcionando, a alça é que não existe.
   *
   * Faz uma coisa só, e ela é estrutural: NÃO monta `DndContext`. É o que mata
   * de verdade o `DndContext` dentro de `DndContext` (a lista de itens vive
   * dentro da lista de grupos, que é arrastável) e o que elimina de graça o
   * `screenReaderInstructions` — o dnd-kit renderiza `<Accessibility>`
   * INCONDICIONALMENTE, com as instruções "pressione espaço para arrastar" e uma
   * `aria-live` PRÓPRIA. Sem contexto não há nem a frase que descreveria uma
   * alça inexistente nem uma TERCEIRA região viva na tela.
   *
   * `mensagemInicial` continua sendo do chamador: dizer "use os botões mover
   * para cima e para baixo" em vez de falar em arrastar é escolha de copy dele.
   */
  semArrasto?: boolean;
  /**
   * Avisa o pai que um arrasto COMEÇOU (issue 216). Existe por um motivo só: o
   * cartão de associação precisa COLAPSAR o painel de itens antes de a linha
   * sair do lugar — um fantasma de 400px de altura sob o dedo é injogável, e o
   * placeholder de origem manteria essa altura toda. Opt-in: sem ele nada muda.
   */
  aoComecarArrasto?: () => void;
  /**
   * Como desenhar cada linha. Default: a `LinhaCategoriaReordenavel` de sempre —
   * o markup dos consumidores atuais não muda um byte (`Fragment` com `key` não
   * emite markup). Existe porque a linha de ITEM (216) tem três estados que
   * trocam o `<li>` inteiro e não chama `useSortable`; enfiar isso na linha de
   * categoria seria gutá-la.
   */
  renderLinha?: (ctx: ContextoLinhaReordenavel) => ReactNode;
  ref?: Ref<ManipuladorModoReordenar>;
};

/**
 * Chama `renderLinha` dentro de um componente. Ver o comentário no `map`: não é
 * indireção gratuita, é o que mantém o `mover` (que lê `ordemRef`) fora do
 * render do `ModoReordenar`. Devolve o que a função devolver, sem markup extra.
 */
function LinhaRenderizada({
  render,
  item,
  indice,
  total,
  bloqueado,
  onMover,
}: { render: (ctx: ContextoLinhaReordenavel) => ReactNode } & ContextoLinhaReordenavel) {
  return <>{render({ item, indice, total, bloqueado, onMover })}</>;
}

/** Linha padrão — o JSX de sempre, extraído para poder ser o default acima. */
function linhaPadrao({
  item,
  indice,
  total,
  bloqueado,
  onMover,
}: ContextoLinhaReordenavel): ReactNode {
  return (
    <LinhaCategoriaReordenavel
      id={item.id}
      nome={item.nome}
      detalhe={item.detalhe}
      prefixo={item.prefixo}
      // Compacta exatamente quando há checkbox na linha: é o prefixo que come
      // os ~44px que fazem o nome não caber em 360px. Sem ele (categorias de
      // produto, 175), a linha continua como era.
      compacta={item.prefixo != null}
      bloqueado={bloqueado}
      indice={indice}
      total={total}
      onMover={onMover}
    />
  );
}

export function ModoReordenar({
  itens,
  onReordenar,
  mensagemInicial,
  rodape,
  semCartao = false,
  ocultarStatus = false,
  aoMudarStatus,
  arrastoBloqueado = false,
  semArrasto = false,
  aoComecarArrasto: avisarArrastoIniciado,
  renderLinha = linhaPadrao,
  ref,
}: ModoReordenarProps) {
  const [ordem, setOrdem] = useState<readonly ItemReordenavel[]>(itens);
  const [mensagemViva, setMensagemViva] = useState(mensagemInicial);
  const [status, setStatus] = useState<StatusSalvamento>("");
  const [idArrastando, setIdArrastando] = useState<string | null>(null);

  // Lido pelos `announcements` do dnd-kit e pelos handlers, que capturariam um
  // `ordem` velho. Sincronizado em efeito (escrever ref durante o render é
  // proibido): o efeito passivo é liberado antes do próximo evento discreto,
  // então todo handler de clique/arrasto já lê o valor recém-commitado.
  const ordemRef = useRef<readonly ItemReordenavel[]>(itens);
  useEffect(() => {
    ordemRef.current = ordem;
  }, [ordem]);

  // Espelha o status para o pai por EFEITO, não de dentro da máquina de
  // salvamento: ela é criada uma vez (inicializador preguiçoso abaixo) e
  // capturaria para sempre a primeira identidade de `aoMudarStatus`.
  useEffect(() => {
    aoMudarStatus?.(status);
  }, [status, aoMudarStatus]);

  /*
    Criada UMA vez, pelo inicializador preguiçoso de `useState`: recriá-la a cada
    render perderia o timer, a fila e a ordem confirmada. `useState` e não
    `useRef` de propósito — ler `ref.current` durante o render é proibido
    (react-hooks/refs), e aqui a máquina precisa estar disponível já no primeiro.
    Toda a regra está testada em `salvamento-coalescido.test.ts`; o que sobra
    aqui são só os efeitos de tela.

    `onReordenar` e `itens` são capturados no primeiro render de propósito: o
    componente é montado ao ENTRAR no modo e desmontado ao sair, e os pontos de
    chamada passam uma Server Action de módulo (identidade estável). A ordem
    inicial confirmada é, por definição, a que o servidor acabou de entregar.
  */
  const [salvamento] = useState<SalvamentoCoalescido<readonly ItemReordenavel[]>>(
    () =>
      criarSalvamentoCoalescido<readonly ItemReordenavel[]>({
        confirmada: itens,
        atrasoMs: DEBOUNCE_MS,
        // O cliente manda SÓ a sequência de ids; `ordem` é derivada no servidor.
        salvar: (proxima) => onReordenar(proxima.map((i) => i.id)),
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
  useImperativeHandle(
    ref,
    () => ({
      finalizar: () => salvamento.finalizar(),
      anunciar: (mensagem: string) => setMensagemViva(mensagem),
    }),
    [salvamento],
  );

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
      const item = atual[de];
      // moverPorDeslocamento já devolve readonly ItemReordenavel[] (T inferido de
      // `atual`); nenhum cast é necessário — ver tipos de estado acima.
      const proxima = moverPorDeslocamento(atual, de, para);

      // Mesma referência = no-op: NÃO escreve no banco (cenário 3) e a seta no
      // limite fica inerte (cenário 8). Uma regra só, sem `if` espalhado.
      if (proxima === atual) {
        if (anunciar && item) {
          setMensagemViva(
            para <= 0
              ? `${item.nome} já está na primeira posição.`
              : `${item.nome} já está na última posição.`,
          );
        }
        return;
      }

      setOrdem(proxima);
      if (anunciar && item) {
        setMensagemViva(
          mensagemPosicao(item.nome, proxima.indexOf(item), proxima.length),
        );
      }
      salvamento.agendar(proxima);
    },
    [salvamento],
  );

  const posicaoDe = useCallback(
    (id: string) => ordemRef.current.findIndex((i) => i.id === id) + 1,
    [],
  );
  const nomeDe = useCallback(
    (id: string) => ordemRef.current.find((i) => i.id === id)?.nome ?? "",
    [],
  );
  const totalAtual = useCallback(() => ordemRef.current.length, []);

  function aoComecarArrasto(evento: DragStartEvent) {
    setIdArrastando(String(evento.active.id));
    avisarArrastoIniciado?.();
  }

  function aoSoltar(evento: DragEndEvent) {
    setIdArrastando(null);
    const { active, over } = evento;
    if (!over) return;
    const atual = ordemRef.current;
    const de = atual.findIndex((i) => i.id === active.id);
    const para = atual.findIndex((i) => i.id === over.id);
    if (de < 0 || para < 0 || de === para) return; // soltar sobre si: zero escrita
    mover(de, para, false);
  }

  const ids = useMemo(() => ordem.map((i) => i.id), [ordem]);
  const arrastada = ordem.find((i) => i.id === idArrastando) ?? null;

  // `<ol>` semântico; `key` = id (por índice quebraria animação e foco).
  const conteudoDaLista = (
    <ol className="motion-reduce:transition-none">
      {ordem.map((item, indice) => (
        // `LinhaRenderizada` devolve um Fragment: NÃO emite markup, então o HTML
        // dos consumidores atuais não muda um byte. Ela existe para que
        // `renderLinha` seja chamada DENTRO de um componente, com `onMover`
        // chegando como prop — chamá-la aqui, passando uma função que lê um
        // `ref`, é acesso a ref durante o render (regra `react-hooks/refs`).
        <LinhaRenderizada
          key={item.id}
          render={renderLinha}
          item={item}
          indice={indice}
          total={ordem.length}
          bloqueado={arrastoBloqueado}
          onMover={mover}
        />
      ))}

      {/*
        Linha fixa do chamador (hoje só o "Sem categoria" de produtos):
        fica FORA do SortableContext, no fim, e NUNCA entra no payload.
      */}
      {rodape}
    </ol>
  );

  /*
    Com `semArrasto`, o `<ol>` é renderizado DIRETO: nenhum `DndContext`, logo
    nenhum `<Accessibility>` do dnd-kit — nem as instruções de arrasto nem a
    região viva dele. Sensores e anúncios moram dentro do `EnvelopeArrasto`
    justamente para não serem sequer criados nesse caminho (e porque hook não
    pode ser chamado condicionalmente).
  */
  const lista = semArrasto ? (
    conteudoDaLista
  ) : (
    <EnvelopeArrasto
      ids={ids}
      arrastada={arrastada}
      nomeDe={nomeDe}
      posicaoDe={posicaoDe}
      totalAtual={totalAtual}
      aoComecarArrasto={aoComecarArrasto}
      aoSoltar={aoSoltar}
      aoCancelar={() => setIdArrastando(null)}
    >
      {conteudoDaLista}
    </EnvelopeArrasto>
  );

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

      {/*
        Embutida (issue 213), a lista já vive dentro do cartão do chamador:
        um segundo `<Card>` desenharia borda sobre borda.
      */}
      {semCartao ? (
        lista
      ) : (
        <Card>
          <CardContent className="p-0">{lista}</CardContent>
        </Card>
      )}

      {/*
        Status agregado, não um toast por movimento (uma chuva de notificações)
        nem um spinner por linha (a lista tremeria a cada toque).
        `aria-hidden`: a região viva acima já cobre o leitor de tela — duplicar
        causaria anúncio duplo. Quando o pai agrega o próprio status (213), ele
        esconde este para não haver dois textos dizendo a mesma coisa.
      */}
      {!ocultarStatus && (
        <p aria-hidden className="h-4 text-xs text-muted-foreground">
          {status === "salvando" && "Salvando ordem…"}
          {status === "salvo" && "Ordem salva"}
        </p>
      )}
    </div>
  );
}

/**
 * Tudo que só existe quando HÁ arrasto (issue 216): contexto, sensores,
 * anúncios em pt-BR e o `DragOverlay`. Componente separado — e não um `if`
 * dentro do `ModoReordenar` — porque `useSensors`/`useMemo` são hooks e não
 * podem ser chamados condicionalmente: com `semArrasto`, este componente
 * simplesmente não é montado e nada disso é criado.
 *
 * Não emite markup próprio: o HTML das listas arrastáveis de hoje é idêntico.
 */
function EnvelopeArrasto({
  ids,
  arrastada,
  nomeDe,
  posicaoDe,
  totalAtual,
  aoComecarArrasto,
  aoSoltar,
  aoCancelar,
  children,
}: {
  ids: string[];
  arrastada: ItemReordenavel | null;
  nomeDe: (id: string) => string;
  posicaoDe: (id: string) => number;
  totalAtual: () => number;
  aoComecarArrasto: (evento: DragStartEvent) => void;
  aoSoltar: (evento: DragEndEvent) => void;
  aoCancelar: () => void;
  children: ReactNode;
}) {
  // Com alça dedicada, `distance: 8` basta — não é preciso um TouchSensor com
  // janela de delay (que faria a tela parecer travada por 250ms).
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  /** Substitui os `announcements` do dnd-kit, que são em inglês por padrão. */
  const anuncios: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) =>
        `Arrastando ${nomeDe(String(active.id))}. Posição ${posicaoDe(
          String(active.id),
        )} de ${totalAtual()}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${nomeDe(String(active.id))} será colocada na posição ${posicaoDe(
              String(over.id),
            )} de ${totalAtual()}.`
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `${nomeDe(String(active.id))} movida para a posição ${posicaoDe(
              String(active.id),
            )} de ${totalAtual()}.`
          : undefined,
      onDragCancel: ({ active }) =>
        `Arrasto cancelado. ${nomeDe(String(active.id))} continua na posição ${posicaoDe(
          String(active.id),
        )} de ${totalAtual()}.`,
    }),
    [nomeDe, posicaoDe, totalAtual],
  );

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCenter}
      accessibility={{
        announcements: anuncios,
        screenReaderInstructions: INSTRUCOES_LEITOR,
      }}
      onDragStart={aoComecarArrasto}
      onDragEnd={aoSoltar}
      onDragCancel={aoCancelar}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
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
  );
}
