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

  const prever = useCallback(
    async (alvo: AlvoDoLote, escopo: EscopoDoLote): Promise<void> => {
      if (acoes === undefined || prevendo || pendente) return;
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

  const confirmar = useCallback(async (): Promise<void> => {
    if (pedido === null || acoes === undefined) return;
    const { alvo, escopo } = pedido;
    setPendente(true);
    try {
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
  }, [acoes, onConcluido, pedido]);

  return {
    abrirCardapio,
    abrirVisibilidade,
    prevendo,
    pendente,
    dialogoAberto: pedido !== null,
    dialogo:
      pedido === null ? null : (
        <DialogoLoteCardapio
          previa={pedido.previa}
          alvo={pedido.alvo}
          pendente={pendente}
          onConfirmar={() => void confirmar()}
          onCancelar={() => {
            if (!pendente) setPedido(null);
          }}
        />
      ),
  };
}
