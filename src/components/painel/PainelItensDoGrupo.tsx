"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  FormularioItemInline,
  LinhaItemOpcional,
  type ModoLinhaItem,
} from "@/components/painel/LinhaItemOpcional";
import { ReordenarItensDoGrupo } from "@/components/painel/ReordenarItensDoGrupo";
import type { ManipuladorModoReordenar } from "@/components/painel/ModoReordenar";
import {
  fraseAlcanceDoPainel,
  rotuloAlcance,
} from "@/lib/utils/alcance-do-grupo";
import type { StatusSalvamento } from "@/lib/utils/salvamento-coalescido";
import type { OpcionalFormData } from "@/lib/validacoes/opcional";
import type { Opcional } from "@/lib/supabase/queries/opcionais";
import type { OpcionaisClientAcoes } from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient";

/**
 * Painel de ITENS de um grupo de opcional, aberto de dentro do cartão de
 * associação (issue 216). Dono do estado e da fiação das 5 actions — todas já
 * existentes (088/089/215): esta issue não abre superfície de escrita nova.
 *
 * ─────────────────────────────────────────── O risco nº 1 desta tela
 * `atualizarOpcional` faz `update({ ...parsed.data })` e `schemaOpcional` é
 * `.strict()` EXIGINDO `ordem`. Então salvar a edição inline escreve `ordem`
 * junto. Cenário de corrupção: A(0) B(1) C(2); o lojista move C para o topo e a
 * RPC grava C=0, A=1, B=2 — mas as props ainda dizem C=2, porque reordenar não
 * faz `router.refresh()` de propósito. Editar o nome de C mandaria `ordem: 2` e
 * C voltaria para o fim na cara do lojista.
 *
 * Regra obrigatória, por isso, em TODA mutação daqui:
 *  1. `await itensRef.current?.finalizar()` ANTES da action (flush do
 *     salvamento coalescido — mesmo padrão do toggle do cartão);
 *  2. o payload leva `ordem: indice` (o índice pós-flush que o `renderLinha`
 *     entrega), nunca o `item.ordem` das props.
 *
 * `alternarOpcionalAtivo` e `removerOpcional` não tocam `ordem` — o flush ali é
 * só para não deixar movimento pendente correndo com o `router.refresh()`.
 *
 * ─────────────────────────────────────────── Uma linha aberta por vez
 * No máximo UMA linha fora de `leitura`: duas confirmações abertas dariam duas
 * perguntas e um só `Escape`, que é ambíguo.
 *
 * ─────────────────────────────────────────── Anúncios
 * Todo evento de ITEM passa pela região viva do `ModoReordenar` desta lista,
 * via `anunciar()`. Nunca uma `aria-live` nova: com o painel aberto já há duas
 * na tela (grupos e itens), e isso só é aceitável porque cada evento é escrito
 * em exatamente uma delas. Quando a lista não está montada (grupo vazio) o
 * fallback local assume o papel — mesmo desenho do cartão.
 */

export type PainelItensDoGrupoProps = {
  /** `id` do `<div>`, alvo do `aria-controls` do gatilho do disclosure. */
  id: string;
  grupoId: string;
  grupoNome: string;
  /** TODOS os itens do grupo, ativos e inativos, já ordenados. */
  itens: readonly Opcional[];
  /** Nomes das categorias de PRODUTO que usam o grupo. */
  alcance: readonly string[];
  acoes: OpcionaisClientAcoes;
  /** `router.refresh()` do cartão. */
  onSalvo: () => void;
  /** Espelha o status da ordem para o status AGREGADO do cartão. */
  aoMudarStatus?: (status: StatusSalvamento) => void;
};

export function PainelItensDoGrupo({
  id,
  grupoId,
  grupoNome,
  itens,
  alcance,
  acoes,
  onSalvo,
  aoMudarStatus,
}: PainelItensDoGrupoProps) {
  const [linhaAberta, setLinhaAberta] = useState<{
    id: string;
    modo: Exclude<ModoLinhaItem, "leitura">;
  } | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  /** Id da linha com chamada em voo (`"novo"` para o item ainda sem id). */
  const [idEmVoo, setIdEmVoo] = useState<string | null>(null);
  const [mensagemSemLista, setMensagemSemLista] = useState("");

  const itensRef = useRef<ManipuladorModoReordenar | null>(null);
  const botaoAdicionarRef = useRef<HTMLButtonElement>(null);

  const anunciar = useCallback((frase: string) => {
    if (itensRef.current) itensRef.current.anunciar(frase);
    else setMensagemSemLista(frase);
  }, []);

  const porId = useMemo(() => {
    const mapa = new Map<string, Opcional>();
    for (const i of itens) mapa.set(i.id, i);
    return mapa;
  }, [itens]);

  const fraseAlcance = fraseAlcanceDoPainel(alcance, grupoNome);
  const soInativos = itens.length > 0 && itens.every((i) => !i.ativo);

  /**
   * Toda mutação passa por aqui: flush do reorder pendente → action → toast +
   * anúncio → `router.refresh()`. Erro NÃO fecha a linha aberta (fechar
   * pareceria sucesso) e a mensagem exibida é a GENÉRICA da action, nunca um
   * `String(e)` nem código do Postgres.
   */
  const executar = useCallback(
    async (params: {
      chave: string;
      acao: () => Promise<{ ok: true } | { ok: false; erro: string }>;
      aoSucesso: () => void;
    }) => {
      if (idEmVoo != null) return;
      setIdEmVoo(params.chave);
      try {
        // Flush ANTES: senão a `ordem` recém-movida ainda estaria no debounce.
        await itensRef.current?.finalizar();
        const r = await params.acao();
        if (!r.ok) {
          toast.error(r.erro);
          anunciar(r.erro);
          return;
        }
        params.aoSucesso();
        onSalvo();
      } finally {
        setIdEmVoo(null);
      }
    },
    [anunciar, idEmVoo, onSalvo],
  );

  function salvarEdicao(item: Opcional, payload: OpcionalFormData) {
    void executar({
      chave: item.id,
      acao: () => acoes.atualizarOpcional(item.id, payload),
      aoSucesso: () => {
        toast.success(
          alcance.length >= 2
            ? `${payload.nome} atualizado nas ${alcance.length} categorias que usam ${grupoNome}.`
            : `${payload.nome} atualizado.`,
        );
        anunciar(`${payload.nome} atualizado.`);
        setLinhaAberta(null);
      },
    });
  }

  function criarItem(payload: OpcionalFormData) {
    void executar({
      chave: "novo",
      acao: () => acoes.criarOpcional(payload),
      aoSucesso: () => {
        toast.success(`${payload.nome} adicionado.`);
        anunciar(
          `${payload.nome} adicionado. ${itens.length + 1} ` +
            `${itens.length + 1 === 1 ? "opcional" : "opcionais"} no grupo ${grupoNome}.`,
        );
        setNovoAberto(false);
        botaoAdicionarRef.current?.focus();
      },
    });
  }

  function alternarAtivo(item: Opcional) {
    void executar({
      chave: item.id,
      acao: () => acoes.alternarOpcionalAtivo(item.id, !item.ativo),
      aoSucesso: () => {
        const frase = item.ativo
          ? `${item.nome} desativado na vitrine.`
          : `${item.nome} ativado na vitrine.`;
        toast.success(frase);
        anunciar(frase);
      },
    });
  }

  function remover(item: Opcional) {
    void executar({
      chave: item.id,
      acao: () => acoes.removerOpcional(item.id),
      aoSucesso: () => {
        const restantes = itens.length - 1;
        toast.success(`${item.nome} removido.`);
        anunciar(
          `${item.nome} removido. O grupo ${grupoNome} ficou com ${restantes} ` +
            `${restantes === 1 ? "opcional" : "opcionais"}.`,
        );
        setLinhaAberta(null);
        // A linha some e qualquer `ref` para uma linha irmã fica obsoleta na
        // remontagem; o botão "Adicionar" é irmão da lista e sobrevive a ela.
        botaoAdicionarRef.current?.focus();
      },
    });
  }

  function pedirRemocao(item: Opcional) {
    setNovoAberto(false);
    setLinhaAberta({ id: item.id, modo: "confirmando" });
    const rotulo = rotuloAlcance(alcance);
    anunciar(
      `Confirmar remoção de ${item.nome}.` +
        (rotulo === "" ? "" : ` Ele sai de ${rotulo}.`) +
        " Escolha Cancelar ou Remover.",
    );
  }

  function cancelarLinha(item: Opcional, modo: ModoLinhaItem) {
    setLinhaAberta(null);
    if (modo === "confirmando") {
      anunciar(`Remoção cancelada. ${item.nome} continua no grupo ${grupoNome}.`);
    }
  }

  /*
    REMONTA a lista quando o CONJUNTO de itens muda (criar/remover): o
    `ModoReordenar` captura `itens` no primeiro render de propósito — é isso que
    preserva o otimismo durante um movimento. Só o conjunto entra na chave; a
    ordem não, senão cada movimento remontaria a lista sob o dedo. Nome e preço
    editados NÃO precisam da chave: a linha lê o dado fresco de `porId`.
  */
  const chaveDaLista = itens
    .map((i) => i.id)
    .slice()
    .sort()
    .join("|");

  return (
    <div
      id={id}
      // Recuo por RÉGUA vertical, não por margem: ~20px em vez dos ~64px que
      // quatro níveis de recuo ingênuo comeriam dos 360px do modal da 217.
      className="mt-2 ml-2 border-l-2 border-border bg-muted/40 py-2 pl-3"
    >
      {fraseAlcance != null && (
        <p className="mb-2 text-xs text-muted-foreground">{fraseAlcance}</p>
      )}

      {soInativos && (
        <p className="mb-2 text-xs text-muted-foreground">
          Nenhum opcional ativo — o cliente não vê nenhuma opção aqui.
        </p>
      )}

      {itens.length === 0 ? (
        <>
          {/* Fallback da região viva enquanto a lista não está montada — mesmo
              desenho do cartão: duas `aria-live` para a MESMA classe de evento
              silenciariam ou duplicariam o anúncio. */}
          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {mensagemSemLista}
          </p>
          <p className="text-sm text-muted-foreground">
            Nenhum opcional neste grupo ainda.
          </p>
        </>
      ) : (
        <ReordenarItensDoGrupo
          key={chaveDaLista}
          ref={itensRef}
          grupoId={grupoId}
          grupoNome={grupoNome}
          itens={itens}
          onReordenar={acoes.reordenarItensDoGrupoOpcional}
          aoMudarStatus={aoMudarStatus}
          arrastoBloqueado={idEmVoo != null}
          renderLinha={({ item, indice, total, bloqueado, onMover }) => {
            // O dado FRESCO vem das props (o `ModoReordenar` captura a ordem no
            // primeiro render; nome, preço e `ativo` chegam por `porId`).
            const opcional = porId.get(item.id);
            if (opcional == null) return null;
            const modo: ModoLinhaItem =
              linhaAberta?.id === opcional.id ? linhaAberta.modo : "leitura";
            return (
              <LinhaItemOpcional
                item={opcional}
                indice={indice}
                total={total}
                modo={modo}
                // `bloqueado` = alguma mutação DESTE painel em voo: as setas
                // das OUTRAS linhas também ficam inertes, senão um movimento
                // entraria na fila com um conjunto de ids que a remoção em voo
                // vai invalidar (a RPC exige a permutação completa).
                emVoo={bloqueado || idEmVoo === opcional.id}
                alcance={alcance}
                grupoNome={grupoNome}
                onMover={onMover}
                onEditar={() => {
                  setNovoAberto(false);
                  setLinhaAberta({ id: opcional.id, modo: "editando" });
                }}
                onSalvarEdicao={(payload) => salvarEdicao(opcional, payload)}
                onAlternarAtivo={() => alternarAtivo(opcional)}
                onPedirRemocao={() => pedirRemocao(opcional)}
                onConfirmarRemocao={() => remover(opcional)}
                onCancelar={() => cancelarLinha(opcional, modo)}
              />
            );
          }}
        />
      )}

      {/* Linha do item NOVO: mesma forma da edição, inline, sem segundo overlay
          — é o que mantém a 217 sendo só uma troca de container. */}
      {novoAberto && (
        <div className="flex items-start gap-2 border-t border-border/70 pt-2">
          <FormularioItemInline
            grupoId={grupoId}
            ativo
            ordem={itens.length}
            alcance={alcance}
            emVoo={idEmVoo === "novo"}
            onSalvar={criarItem}
            onCancelar={() => {
              setNovoAberto(false);
              botaoAdicionarRef.current?.focus();
            }}
          />
        </div>
      )}

      {/* No rodapé do painel e DENTRO do scroll: barra fixa dentro de modal tela
          cheia briga com o teclado virtual, que é justamente o que sobe quando
          este botão é usado. */}
      <div className="pt-2">
        <Button
          ref={botaoAdicionarRef}
          type="button"
          variant="outline"
          className="min-h-[44px] w-full sm:w-auto"
          aria-label={`Adicionar opcional em ${grupoNome}`}
          onClick={() => {
            if (novoAberto) return;
            setLinhaAberta(null);
            setNovoAberto(true);
          }}
        >
          <Plus aria-hidden className="size-4" />
          Adicionar opcional
        </Button>
      </div>
    </div>
  );
}
