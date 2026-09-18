"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { alternarAssociacaoOpcional } from "@/lib/utils/alternar-associacao-opcional";
import type { StatusSalvamento } from "@/lib/utils/salvamento-coalescido";
import type { CategoriaOpcional, Opcional } from "@/lib/supabase/queries/opcionais";
import {
  ReordenarOpcionaisDaCategoria,
  type GrupoOpcionalReordenavel,
} from "@/components/painel/ReordenarOpcionaisDaCategoria";
import { LinhaCategoriaReordenavel } from "@/components/painel/LinhaCategoriaReordenavel";
import { PainelItensDoGrupo } from "@/components/painel/PainelItensDoGrupo";
import type { ManipuladorModoReordenar } from "@/components/painel/ModoReordenar";
import type {
  CategoriaProduto,
  OpcionaisClientAcoes,
} from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient";

/** 44px literal — `size="icon-sm"` daria 33,6px na base de 120% (design-system §5). */
const ALVO_TOQUE = "min-h-[44px] min-w-[44px]";

/** "3 itens" / "1 item" — a singularização mora onde o domínio é conhecido. */
function rotuloItens(total: number): string {
  return `${total} ${total === 1 ? "item" : "itens"}`;
}

/**
 * Um cartão = uma categoria de PRODUTO (issue 213).
 *
 * ─────────────────────────────────────────── Um modo só
 * Antes havia dois que nunca coexistiam (grade de checkbox OU lista arrastável,
 * atrás de um botão "Reordenar" com gate de ≥2 marcados). Agora a lista já
 * nasce na ORDEM DA VITRINE com o checkbox na própria linha, e o salvamento é
 * automático: some o botão "Salvar" e some o gate.
 *
 * ─────────────────────────────────────────── Por que a lista é SEGMENTADA
 * Razão técnica, não estética: marcados e desmarcados no MESMO
 * `SortableContext` fariam o `closestCenter` do dnd-kit aceitar soltura na
 * região dos desmarcados e produzir posição para um grupo que NÃO tem linha em
 * `categoria_produto_opcionais` — a RPC confere `row_count` e derruba a
 * transação. Com dois segmentos, só os marcados entram no `SortableContext`.
 *
 * ─────────────────────────────────────────── A corrida do autosave
 * Um toggle disparado com um reorder ainda no debounce (500ms) mandaria à RPC
 * um conjunto de ids que não bate com as linhas persistidas → `row_count`
 * mismatch → erro genérico. Por isso o toggle AGUARDA o `finalizar()` do handle
 * imperativo ANTES de mexer no conjunto e de chamar `salvarAssociacaoOpcionais`.
 * Enquanto está em voo, alça e setas ficam `aria-disabled` — nunca `disabled`,
 * que tira da tabulação e perde o foco.
 *
 * ─────────────────────────────────────────── Onde mora "qual grupo está aberto"
 * No CARTÃO, nunca na linha. O cartão REMONTA a lista de grupos por
 * `key={chaveDaLista}` a cada toggle de checkbox; com o estado do disclosure na
 * linha, desmarcar OUTRO grupo fecharia o painel aberto e jogaria o foco no
 * `<body>`. Guardado por `categoria_opcional_id` ele sobrevive à remontagem, e
 * o `gatilhosRef` devolve o foco ao gatilho quando ele se perdeu.
 *
 * UM grupo aberto por cartão: cinco painéis abertos tornariam o modal da 217 um
 * rolo infinito.
 *
 * ─────────────────────────────────────────── Desmarcar perde a posição
 * Decisão do usuário, sem confirmação: `planejarAssociacaoOpcionais` remove a
 * linha, e remarcar reinsere com `ordem = max(permanentes) + 1`, isto é, no FIM.
 * A UI só mostra a verdade que o banco já tinha.
 */
export function CartaoAssociacaoOpcionais({
  categoriaProduto,
  categoriasOpcional,
  selecionadosIniciais,
  ordemPorGrupo,
  totalItensPorGrupo,
  opcionaisPorGrupo,
  alcancePorGrupo,
  onSalvo,
  acoes,
}: {
  categoriaProduto: CategoriaProduto;
  categoriasOpcional: CategoriaOpcional[];
  /** Ids PERSISTIDOS desta categoria de produto (props = verdade do servidor). */
  selecionadosIniciais: Set<string>;
  /** `categoria_opcional_id → ordem` gravada. Ausente = ainda não persistido. */
  ordemPorGrupo: Map<string, number>;
  totalItensPorGrupo: Map<string, number>;
  /** `categoria_opcional_id → itens do grupo` (ativos E inativos), já ordenados. */
  opcionaisPorGrupo: Map<string, Opcional[]>;
  /** `categoria_opcional_id → nomes das categorias de PRODUTO que usam o grupo`. */
  alcancePorGrupo: Map<string, string[]>;
  onSalvo: () => void;
  acoes: OpcionaisClientAcoes;
}) {
  const [selecionados, setSelecionados] =
    useState<Set<string>>(selecionadosIniciais);
  const [togglando, setTogglando] = useState(false);
  const [statusAssociacao, setStatusAssociacao] =
    useState<StatusSalvamento>("");
  const [statusOrdem, setStatusOrdem] = useState<StatusSalvamento>("");
  const [statusItens, setStatusItens] = useState<StatusSalvamento>("");
  const [mensagemSemLista, setMensagemSemLista] = useState("");
  /** Um só painel de itens aberto por cartão, por `categoria_opcional_id`. */
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const gatilhosRef = useRef(new Map<string, HTMLButtonElement | null>());
  const reordenarRef = useRef<ManipuladorModoReordenar | null>(null);
  const togglandoRef = useRef(false);
  // Lido dentro do handler do toggle, que capturaria um `selecionados` velho.
  // Sincronizado em EFEITO (escrever ref durante o render é proibido pelo
  // `react-hooks/refs`): o efeito passivo é liberado antes do próximo evento
  // discreto, então todo clique já lê o valor recém-commitado.
  const selecionadosRef = useRef(selecionados);
  useEffect(() => {
    selecionadosRef.current = selecionados;
  }, [selecionados]);

  /**
   * Região viva dos EVENTOS DE GRUPO (marcar/desmarcar, mover, abrir/fechar
   * painel). É a do `ModoReordenar` quando ele está montado — duas `aria-live`
   * para a MESMA classe de evento silenciam ou duplicam o anúncio. Eventos de
   * ITEM têm a região deles, dentro do `PainelItensDoGrupo`; a divisão é rígida
   * e é o que torna as duas regiões aceitáveis na mesma tela.
   */
  const anunciarGrupo = useCallback((frase: string) => {
    if (reordenarRef.current) reordenarRef.current.anunciar(frase);
    else setMensagemSemLista(frase);
  }, []);

  /**
   * Toggle do checkbox — ÚNICO caminho de escrita da associação.
   *
   * A ORDEM é a trava da corrida descrita no cabeçalho: flush do reorder
   * pendente → novo conjunto → gravação → refresh. Trocar o conjunto antes do
   * flush remontaria a lista (a `key` deriva dos marcados) e o `finalizar()`
   * cairia no handle da instância nova, que não tem o movimento pendente.
   */
  const alternar = useCallback(
    async (catOpcId: string, marcado: boolean) => {
      // Reentrância: dois toggles simultâneos disputariam o mesmo flush.
      if (togglandoRef.current) return;
      togglandoRef.current = true;
      setTogglando(true);

      const anterior = selecionadosRef.current;
      const nome =
        categoriasOpcional.find((c) => c.id === catOpcId)?.nome ?? "Grupo";
      const total = marcado
        ? anterior.size + (anterior.has(catOpcId) ? 0 : 1)
        : anterior.size - (anterior.has(catOpcId) ? 1 : 0);
      const frase = marcado
        ? `${nome} incluído. Posição ${total} de ${total}.`
        : `${nome} removido. ${total} ${total === 1 ? "grupo" : "grupos"} na ordem.`;

      try {
        // A ORDEM (flush → seleção → gravação) é a trava da corrida e mora em
        // `alternarAssociacaoOpcional`, fora do componente, porque aqui dentro
        // ela era inalcançável por teste — ver o cabeçalho daquele arquivo.
        await alternarAssociacaoOpcional(anterior, catOpcId, marcado, frase, {
          finalizarReordenacao: () => reordenarRef.current?.finalizar(),
          salvar: (ids) =>
            acoes.salvarAssociacaoOpcionais({
              categoria_id: categoriaProduto.id,
              categoria_opcional_id: ids,
            }),
          aplicarSelecao: setSelecionados,
          definirStatus: setStatusAssociacao,
          avisarErro: (m) => toast.error(m),
          anunciar: anunciarGrupo,
          aoSucesso: onSalvo,
          registrarErro: (e) => console.error("[alternarAssociacao]", e),
        });
      } finally {
        togglandoRef.current = false;
        setTogglando(false);
      }
    },
    [acoes, anunciarGrupo, categoriaProduto.id, categoriasOpcional, onSalvo],
  );

  /*
    Só os marcados, na ordem do servidor. Quem ainda NÃO tem linha gravada (o
    recém-marcado, antes do `router.refresh()`) vai para o FIM — é onde
    `planejarAssociacaoOpcionais` acabou de inseri-lo. Usar 0 como default o
    jogaria para o topo e a tela mentiria por uma fração de segundo. O desempate
    por id espelha o segundo `.order` de `buscarAssociacoesOpcional`: sem ele,
    linhas pré-208 (todas com `ordem = 0`) abririam numa ordem que o SSR não
    garante.
  */
  const gruposMarcados = useMemo<GrupoOpcionalReordenavel[]>(
    () =>
      categoriasOpcional
        .filter((c) => selecionados.has(c.id))
        .map((c) => ({
          id: c.id,
          nome: c.nome,
          totalItens: totalItensPorGrupo.get(c.id) ?? 0,
          prefixo: (
            <span
              className={`${ALVO_TOQUE} flex shrink-0 items-center justify-center`}
            >
              <Checkbox
                checked
                aria-label={`Remover ${c.nome} dos opcionais de ${categoriaProduto.nome}`}
                onCheckedChange={() => void alternar(c.id, false)}
              />
            </span>
          ),
        }))
        .sort((a, b) => {
          const ordemA = ordemPorGrupo.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ordemB = ordemPorGrupo.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ordemA - ordemB || a.id.localeCompare(b.id);
        }),
    [
      categoriasOpcional,
      selecionados,
      ordemPorGrupo,
      totalItensPorGrupo,
      categoriaProduto.nome,
      alternar,
    ],
  );

  /**
   * Abre/fecha o painel de itens de um grupo. UM aberto por cartão: abrir B
   * fecha A, e o anúncio diz as duas coisas numa frase só.
   */
  const alternarPainel = useCallback(
    (catOpcId: string, nome: string) => {
      if (grupoAberto === catOpcId) {
        setGrupoAberto(null);
        anunciarGrupo(`${nome} fechado.`);
        return;
      }
      const total = opcionaisPorGrupo.get(catOpcId)?.length ?? 0;
      const nomeAnterior =
        grupoAberto == null
          ? null
          : (categoriasOpcional.find((c) => c.id === grupoAberto)?.nome ?? null);
      setGrupoAberto(catOpcId);
      anunciarGrupo(
        (nomeAnterior == null ? "" : `${nomeAnterior} fechado. `) +
          `${nome} aberto. ${total} ${total === 1 ? "opcional" : "opcionais"}, ` +
          "na ordem da vitrine.",
      );
    },
    [anunciarGrupo, categoriasOpcional, grupoAberto, opcionaisPorGrupo],
  );

  const disponiveis = useMemo(
    () => categoriasOpcional.filter((c) => !selecionados.has(c.id)),
    [categoriasOpcional, selecionados],
  );


  /*
    Status AGREGADO do cartão: um só texto para a associação e para a ordem.
    Dois indicadores lado a lado dizendo "Salvando…" seriam ruído, e o lojista
    não faz ideia de que são duas escritas diferentes.
  */
  const status: StatusSalvamento =
    statusAssociacao === "salvando" ||
    statusOrdem === "salvando" ||
    statusItens === "salvando"
      ? "salvando"
      : statusAssociacao === "salvo" ||
          statusOrdem === "salvo" ||
          statusItens === "salvo"
        ? "salvo"
        : "";

  /*
    REMONTA a lista quando o conjunto de marcados muda: o `ModoReordenar`
    captura `itens` no primeiro render de propósito (é isso que preserva o
    otimismo durante o arrasto), então sem a `key` um grupo recém-marcado nunca
    apareceria. Só o CONJUNTO entra na chave — a ordem não, senão cada arrasto
    remontaria a lista sob o dedo.
  */
  const chaveDaLista = Array.from(selecionados).sort().join("|");

  /*
    A remontagem da lista (toggle de checkbox) destrói o nó que tinha o foco. O
    estado do disclosure sobrevive porque mora AQUI, mas o foco não: sem isto
    ele cai no `<body>`. Só recupera quando REALMENTE caiu no body — nunca
    rouba o foco de um controle vivo.
  */
  const chaveAnteriorRef = useRef(chaveDaLista);
  useEffect(() => {
    const mudou = chaveAnteriorRef.current !== chaveDaLista;
    chaveAnteriorRef.current = chaveDaLista;
    if (!mudou || grupoAberto == null) return;
    if (typeof document === "undefined") return;
    if (document.activeElement !== document.body) return;
    gatilhosRef.current.get(grupoAberto)?.focus();
  }, [chaveDaLista, grupoAberto]);

  return (
    <AccordionItem
      value={categoriaProduto.id}
      className="not-last:border-b-0"
    >
      <Card>
        <div className="flex items-center justify-between gap-2 border-b px-4 [&>h3]:min-w-0 [&>h3]:flex-1">
          <AccordionTrigger className="min-h-[44px] font-heading text-base font-semibold text-foreground">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{categoriaProduto.nome}</span>
              <Badge variant="outline">
                {selecionados.size}{" "}
                {selecionados.size === 1 ? "incluído" : "incluídos"}
              </Badge>
            </span>
          </AccordionTrigger>
        </div>

        <AccordionContent className="pt-0 pb-0">
          <CardContent className="space-y-3 p-4">
            {categoriasOpcional.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Crie categorias de opcional para poder associá-las.
              </p>
            ) : (
              <>
                {gruposMarcados.length === 0 ? (
                  <>
                    <p
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className="sr-only"
                    >
                      {mensagemSemLista}
                    </p>
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      Nenhum grupo incluído ainda. Marque um em
                      &ldquo;Disponíveis&rdquo; para incluir.
                    </p>
                  </>
                ) : (
                  <ReordenarOpcionaisDaCategoria
                    key={chaveDaLista}
                    ref={reordenarRef}
                    categoriaProdutoId={categoriaProduto.id}
                    grupos={gruposMarcados}
                    onReordenar={acoes.reordenarOpcionaisDaCategoria}
                    semCartao
                    ocultarStatus
                    aoMudarStatus={setStatusOrdem}
                    arrastoBloqueado={togglando}
                    // Arrastar um grupo COLAPSA o painel dele antes de a linha
                    // sair do lugar: um fantasma de 400px sob o dedo é
                    // injogável, e o placeholder de origem manteria a altura.
                    aoComecarArrasto={() => setGrupoAberto(null)}
                    renderLinha={({
                      item,
                      indice,
                      total,
                      bloqueado,
                      onMover,
                    }) => {
                      const aberto = grupoAberto === item.id;
                      const idPainel = `itens-${categoriaProduto.id}-${item.id}`;
                      return (
                        <LinhaCategoriaReordenavel
                          id={item.id}
                          nome={item.nome}
                          detalhe={item.detalhe}
                          prefixo={item.prefixo}
                          compacta={item.prefixo != null}
                          bloqueado={bloqueado}
                          indice={indice}
                          total={total}
                          onMover={onMover}
                          /*
                            O gatilho do disclosure é o BLOCO DO NOME, não um
                            botão novo: em 360px a linha já está no teto de
                            largura (checkbox + alça + nº + ↑ + ↓ + kebab) e um
                            5º alvo de 44px estouraria. O nome é o elemento mais
                            largo da linha e vira o maior alvo de toque da tela.
                          */
                          conteudo={
                            <button
                              type="button"
                              ref={(n) => {
                                gatilhosRef.current.set(item.id, n);
                              }}
                              aria-expanded={aberto}
                              aria-controls={idPainel}
                              onClick={() => alternarPainel(item.id, item.nome)}
                              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              <ChevronRight
                                aria-hidden
                                className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
                                  aberto ? "rotate-90" : ""
                                }`}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {item.nome}
                                </span>
                                {item.detalhe != null && (
                                  <span className="block text-xs text-muted-foreground">
                                    {item.detalhe}
                                  </span>
                                )}
                              </span>
                            </button>
                          }
                          painel={
                            aberto ? (
                              <PainelItensDoGrupo
                                id={idPainel}
                                grupoId={item.id}
                                grupoNome={item.nome}
                                itens={opcionaisPorGrupo.get(item.id) ?? []}
                                alcance={alcancePorGrupo.get(item.id) ?? []}
                                acoes={acoes}
                                onSalvo={onSalvo}
                                aoMudarStatus={setStatusItens}
                              />
                            ) : null
                          }
                        />
                      );
                    }}
                  />
                )}

                <Separator />

                {/*
                  Segmento COLAPSADO por padrão e SEM alça: nada aqui tem
                  posição, e uma alça que não move nada seria um controle que
                  não faz nada.
                */}
                <Accordion>
                  <AccordionItem
                    value="disponiveis"
                    className="not-last:border-b-0"
                  >
                    <AccordionTrigger className="min-h-[44px] -mx-4 rounded-none bg-muted/60 px-4 text-sm font-medium text-foreground">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        Disponíveis ({disponiveis.length})
                        <span className="text-xs font-normal text-muted-foreground">
                          o cliente não vê estes
                        </span>
                      </span>
                    </AccordionTrigger>
                    {/* `keepMounted`: o segmento nasce colapsado, mas o
                        conteúdo já vem do servidor — sem ele os checkboxes de
                        "Incluir" não existiriam no DOM até o primeiro clique. */}
                    <AccordionContent keepMounted>
                      {disponiveis.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Todos os grupos já estão incluídos.
                        </p>
                      ) : (
                        <>
                          <p className="mb-1 text-xs text-muted-foreground">
                            Marque para incluir — entra no fim da ordem.
                          </p>
                          <ul className="divide-y divide-foreground/10">
                            {disponiveis.map((catOpc) => (
                              <li key={catOpc.id}>
                                <label className="flex cursor-pointer items-center gap-2 py-1">
                                  <span
                                    className={`${ALVO_TOQUE} flex shrink-0 items-center justify-center`}
                                  >
                                    <Checkbox
                                      checked={false}
                                      aria-label={`Incluir ${catOpc.nome} nos opcionais de ${categoriaProduto.nome}`}
                                      onCheckedChange={() =>
                                        void alternar(catOpc.id, true)
                                      }
                                    />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                                      {catOpc.nome}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {rotuloItens(
                                        totalItensPorGrupo.get(catOpc.id) ?? 0,
                                      )}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                {/*
                  `aria-hidden`: a região viva do modo já cobre o leitor de tela.
                */}
                <div
                  aria-hidden
                  className="-mx-4 mt-1 flex min-h-8 items-center justify-end gap-1.5 border-t border-border px-4 pt-2 text-xs text-muted-foreground"
                >
                  {status === "salvando" && <span>Salvando…</span>}
                  {status === "salvo" && (
                    <>
                      <Check className="size-3.5 text-emerald-600" />
                      <span className="font-medium text-emerald-700">Salvo</span>
                    </>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </AccordionContent>
      </Card>
    </AccordionItem>
  );
}
