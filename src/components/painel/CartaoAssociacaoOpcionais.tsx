"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
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
import type { CategoriaOpcional } from "@/lib/supabase/queries/opcionais";
import {
  ReordenarOpcionaisDaCategoria,
  type GrupoOpcionalReordenavel,
} from "@/components/painel/ReordenarOpcionaisDaCategoria";
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
  onSalvo: () => void;
  acoes: OpcionaisClientAcoes;
}) {
  const [selecionados, setSelecionados] =
    useState<Set<string>>(selecionadosIniciais);
  const [togglando, setTogglando] = useState(false);
  const [statusAssociacao, setStatusAssociacao] =
    useState<StatusSalvamento>("");
  const [statusOrdem, setStatusOrdem] = useState<StatusSalvamento>("");
  const [mensagemSemLista, setMensagemSemLista] = useState("");
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
          // A região viva é a do `ModoReordenar` quando ele está montado — duas
          // `aria-live` na mesma tela silenciam ou duplicam o anúncio.
          anunciar: (f) => {
            if (reordenarRef.current) {
              reordenarRef.current.anunciar(f);
            } else {
              setMensagemSemLista(f);
            }
          },
          aoSucesso: onSalvo,
          registrarErro: (e) => console.error("[alternarAssociacao]", e),
        });
      } finally {
        togglandoRef.current = false;
        setTogglando(false);
      }
    },
    [acoes, categoriaProduto.id, categoriasOpcional, onSalvo],
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
    statusAssociacao === "salvando" || statusOrdem === "salvando"
      ? "salvando"
      : statusAssociacao === "salvo" || statusOrdem === "salvo"
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
