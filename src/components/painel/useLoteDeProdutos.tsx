"use client";

import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  DialogoLoteCardapio,
  type AlvoDoLote,
} from "@/components/painel/DialogoLoteCardapio";
import type {
  AcoesLote,
  CardapioParaLote,
  PreviaDoLote,
} from "@/components/painel/contrato-lote";
import type { AcaoLote, AcaoVisibilidade } from "@/lib/utils/copiaLotePromocao";
import { payloadsDeDiasEmLote } from "@/components/painel/agendaDoVinculo";
import { MSG_DIAS_DO_VINCULO } from "@/lib/actions/cardapio-contrato";
import { TETO_LOTE } from "@/lib/validacoes/produto";

/**
 * [Auditoria 260/261] O teto de cardinalidade (CWE-770) explicado ANTES de
 * virar recusa. "Selecionar os N" não conhece o teto: numa categoria com mais
 * de `TETO_LOTE` produtos a PRÉVIA falhava no parse e o lojista lia
 * "não foi possível" sem saber que existe um limite nem o que fazer.
 *
 * O `.max()` do zod continua sendo a autoridade — esta frase não afrouxa nada,
 * só deixa de esconder o número que já decide a recusa.
 */
const MSG_TETO = `Dá para aplicar uma ação a no máximo ${TETO_LOTE} produtos por vez. Desmarque alguns e tente de novo.`;

/**
 * O escopo do lote, na FORMA que a Server Action recebe — nunca uma lista que
 * o cliente expandiu.
 *
 * `categoria` existe porque RN-10 exige que a expansão da categoria aconteça
 * DENTRO da transação (`insert ... select` da RPC): ler os produtos em JS para
 * reenviá-los abriria a janela TOCTOU que a RPC fecha.
 */
export type EscopoDoLote =
  | { tipo: "produtos"; produto_ids: string[] }
  | { tipo: "categoria"; categoria_id: string; categoriaNome: string };

type Pedido = { alvo: AlvoDoLote; escopo: EscopoDoLote; previa: PreviaDoLote };

/**
 * [260] O ciclo inteiro de uma ação em lote — prever no servidor, confirmar,
 * escrever — em um lugar só, para que as DUAS superfícies (`/painel/produtos`
 * e `SeletorProdutosDoCardapio`) usem as MESMAS Server Actions e o MESMO
 * diálogo (RN-09: não duplica).
 *
 * 🔴 A ordem é inegociável (M8): **prévia primeiro**. O diálogo é montado
 * apenas com a resposta do servidor em mãos; enquanto ela está em voo,
 * `prevendo` é `true` e o botão que disparou mostra `Loader2`. Nenhum caminho
 * deste módulo monta o diálogo a partir da seleção do cliente.
 *
 * Nenhuma chamada por id, uma de cada vez: o lote é UMA instrução, tudo ou
 * nada — é assim que a FK composta e o trigger de RN-14 derrubam o lote
 * inteiro em vez de gravar a metade legítima e denunciar o resto.
 */
export function useLoteDeProdutos(
  /**
   * `undefined` quando a superfície não tem lote (o hub admin — ver a prop
   * `lote` de `ProdutosClient`). Regra dos hooks: o hook roda sempre; sem
   * actions ele simplesmente não abre nada.
   */
  acoes: AcoesLote | undefined,
  onConcluido: () => void,
): {
  /** Vincular/desvincular produtos a um cardápio. */
  abrirCardapio: (
    acao: AcaoLote,
    cardapio: CardapioParaLote,
    escopo: EscopoDoLote,
  ) => void;
  /** Declarar D14 para a seleção. */
  abrirVisibilidade: (acao: AcaoVisibilidade, produtoIds: string[]) => void;
  /** [277] Definir a MESMA agenda para vários vínculos deste cardápio. */
  abrirDias: (cardapio: CardapioParaLote, produtoIds: string[]) => void;
  /** Prévia em voo: o chamador troca o ícone do botão por `Loader2`. */
  prevendo: boolean;
  /** Escrita em voo. */
  pendente: boolean;
  /** Há diálogo na tela? O ESC do modo de seleção não pode atropelá-lo. */
  dialogoAberto: boolean;
  /** O diálogo, ou `null` enquanto não houver prévia do servidor. */
  dialogo: ReactNode;
} {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [prevendo, setPrevendo] = useState(false);
  const [pendente, setPendente] = useState(false);
  /**
   * [277] Os dias escolhidos no diálogo moram AQUI, junto do resto do ciclo —
   * o `DialogoLoteCardapio` continua sem estado de payload. Zeram a cada
   * abertura: uma agenda herdada do lote anterior seria escrita sem intenção.
   */
  const [diasEscolhidos, setDiasEscolhidos] = useState<number[]>([]);

  const prever = useCallback(
    async (alvo: AlvoDoLote, escopo: EscopoDoLote): Promise<void> => {
      if (acoes === undefined || prevendo || pendente) return;
      // O teto vale só para a SELEÇÃO EXPLÍCITA: a categoria inteira é
      // expandida dentro da transação (RN-10) e não trafega como lista.
      if (
        escopo.tipo === "produtos" &&
        escopo.produto_ids.length > TETO_LOTE
      ) {
        toast.error(MSG_TETO);
        return;
      }
      setPrevendo(true);
      try {
        // A prévia recebe o MESMO escopo da gravação: seleção explícita vira
        // `produto_ids`, categoria inteira vira `categoria_id`. Traduzir um no
        // outro aqui reintroduziria a expansão em JS que RN-10 proíbe.
        const previa = await acoes.preverLote(
          escopo.tipo === "produtos"
            ? { produto_ids: escopo.produto_ids }
            : { categoria_id: escopo.categoria_id },
        );
        if (!previa.ok) {
          toast.error(previa.erro);
          return;
        }
        setPedido({ alvo, escopo, previa });
      } finally {
        setPrevendo(false);
      }
    },
    [acoes, pendente, prevendo],
  );

  const abrirCardapio = useCallback(
    (acao: AcaoLote, cardapio: CardapioParaLote, escopo: EscopoDoLote) => {
      void prever(
        {
          tipo: "cardapio",
          acao,
          cardapio,
          categoriaNome:
            escopo.tipo === "categoria" ? escopo.categoriaNome : null,
        },
        escopo,
      );
    },
    [prever],
  );

  const abrirVisibilidade = useCallback(
    (acao: AcaoVisibilidade, produtoIds: string[]) => {
      void prever(
        { tipo: "visibilidade", acao },
        { tipo: "produtos", produto_ids: produtoIds },
      );
    },
    [prever],
  );

  const abrirDias = useCallback(
    (cardapio: CardapioParaLote, produtoIds: string[]) => {
      setDiasEscolhidos([]);
      // `dias` e `onDias` entram no render do diálogo, não aqui: o `alvo`
      // guardado é só a identidade da ação.
      void prever(
        { tipo: "dias", cardapio, dias: [], onDias: () => {} },
        { tipo: "produtos", produto_ids: produtoIds },
      );
    },
    [prever],
  );

  const confirmar = useCallback(async (): Promise<void> => {
    if (pedido === null || acoes === undefined) return;
    const { alvo, escopo } = pedido;
    setPendente(true);
    try {
      /**
       * [277] "Definir dias" é FAN-OUT: N escritas, cada uma individualmente
       * escopada pela tripla com `count: "exact"` de [274]. É a única
       * divergência registrada do princípio "o lote é UMA instrução", e a
       * consequência assumida é ATOMICIDADE PARCIAL.
       *
       * Falha parcial ou total: o diálogo PERMANECE aberto, uma frase só
       * (`MSG_DIAS_DO_VINCULO` — e não `MSG_GENERICA_LOTE`, que descreveria uma
       * operação que não aconteceu) e o `router.refresh()` do `onConcluido`
       * acontece MESMO ASSIM, para a tela voltar a mostrar a verdade do banco.
       * Sem contagem parcial: o servidor não tem número confiável nesse
       * instante (o mesmo argumento de `MSG_EXCLUSIVOS_SEM_NUMERO`).
       */
      if (alvo.tipo === "dias") {
        const ids = escopo.tipo === "produtos" ? escopo.produto_ids : [];
        const escritas = await Promise.allSettled(
          payloadsDeDiasEmLote(alvo.cardapio.id, ids, diasEscolhidos).map(
            (payload) => acoes.definirDias(payload),
          ),
        );
        const todasOk = escritas.every(
          (e) => e.status === "fulfilled" && e.value.ok,
        );
        if (!todasOk) {
          toast.error(MSG_DIAS_DO_VINCULO);
          onConcluido();
          return;
        }
        toast.success("Dias atualizados.");
        setPedido(null);
        onConcluido();
        return;
      }

      const resultado =
        alvo.tipo === "visibilidade"
          ? await acoes.definirVisibilidade({
              produto_ids: escopo.tipo === "produtos" ? escopo.produto_ids : [],
              // O jargão de schema fica AQUI, na fronteira: a tela inteira fala
              // "exclusivo de cardápio" e "do menu".
              visibilidade: alvo.acao === "exclusivo" ? "cardapio" : "menu",
            })
          : escopo.tipo === "categoria"
            ? await acoes.aplicarEmCategoria({
                cardapio_id: alvo.cardapio.id,
                categoria_id: escopo.categoria_id,
              })
            : alvo.acao === "adicionar"
              ? await acoes.aplicarEmProdutos({
                  cardapio_id: alvo.cardapio.id,
                  produto_ids: escopo.produto_ids,
                })
              : await acoes.tirarDeCardapio({
                  cardapio_id: alvo.cardapio.id,
                  produto_ids: escopo.produto_ids,
                });

      if (!resultado.ok) {
        // A recusa de RN-14 chega aqui como frase acionável da Server Action;
        // o resto é a genérica dela. Nada é reescrito no cliente.
        toast.error(resultado.erro);
        return;
      }

      toast.success(
        alvo.tipo === "visibilidade"
          ? "Visibilidade atualizada."
          : alvo.acao === "adicionar"
            ? "Produtos adicionados ao cardápio."
            : "Produtos removidos do cardápio.",
      );
      setPedido(null);
      onConcluido();
    } finally {
      setPendente(false);
    }
  }, [acoes, diasEscolhidos, onConcluido, pedido]);

  return {
    abrirCardapio,
    abrirVisibilidade,
    abrirDias,
    prevendo,
    pendente,
    dialogoAberto: pedido !== null,
    dialogo:
      pedido === null ? null : (
        <DialogoLoteCardapio
          previa={pedido.previa}
          alvo={
            pedido.alvo.tipo === "dias"
              ? { ...pedido.alvo, dias: diasEscolhidos, onDias: setDiasEscolhidos }
              : pedido.alvo
          }
          pendente={pendente}
          onConfirmar={() => void confirmar()}
          onCancelar={() => {
            if (!pendente) setPedido(null);
          }}
        />
      ),
  };
}
