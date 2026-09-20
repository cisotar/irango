"use client";

// [237/238] A ÚNICA porta do cliente para `revisarCarrinhoAction`.
//
// Existe para que o resumo do checkout e a gaveta do carrinho não tenham dois
// caminhos diferentes até os mesmos números — e para que a revisão automática
// (RN-12, camada 1: "ao entrar na etapa final do checkout") seja DEBOUNCED e
// deduplicada pela CHAVE (conteúdo do carrinho + cupom): a action tem balde
// próprio de rate limit, mas uma chamada por clique no `+` o esgotaria por
// conta de UX (achado do `auditar`).
//
// 🛑 Nada é calculado aqui. `subtotal`, `economiaProdutos`, os preços por linha
// e o estado A/B/C do cupom chegam PRONTOS do servidor (RN-11 / D5-b). Falha
// de revisão degrada em silêncio: `revisao` fica `null` e a UI simplesmente
// não renderiza as linhas que dependem desses números.
//
// DUAS leituras, de propósito:
//   • `revisao`       — a última que VOLTOU. Tolera carrinho já mudado; serve
//                       ao que é informativo (estado do cupom, economia).
//   • `revisaoFresca` — só quando foi calculada para o carrinho/cupom de AGORA.
//                       É a única que pode virar NÚMERO NA TELA ou abrir o
//                       diálogo de reconfirmação de preço.

import { useCallback, useEffect, useRef, useState } from "react";

import { revisarCarrinhoAction } from "@/lib/actions/revisarCarrinho";
import type { ResultadoRevisarCarrinho } from "@/lib/actions/revisarCarrinho-contrato";
import {
  ATRASO_REVISAO_MS,
  chaveRevisao,
  itensParaRevisao,
  revisaoFrescaDe,
} from "@/lib/utils/itensRevisao";
import type { ItemCarrinho } from "@/types/dominio";

export type RevisaoCarrinho = Extract<ResultadoRevisarCarrinho, { ok: true }>;

export type UsarRevisaoCarrinhoArgs = {
  lojaId: string;
  itens: ItemCarrinho[];
  /** Código aplicado hoje — entra na revisão automática. */
  codigoCupom?: string | null;
  /** `false` suspende a revisão automática (gaveta fechada, carrinho vazio). */
  ativo?: boolean;
};

export function useRevisaoCarrinho({
  lojaId,
  itens,
  codigoCupom = null,
  ativo = true,
}: UsarRevisaoCarrinhoArgs) {
  // A resposta viaja COM a chave para a qual foi calculada — é o que permite
  // dizer, depois, se ela ainda descreve o carrinho que está na tela.
  const [entrada, setEntrada] = useState<{
    chave: string;
    dados: RevisaoCarrinho;
  } | null>(null);
  // Última requisição disparada: guarda de corrida (resposta antiga não
  // sobrescreve a nova) E chave de dedupe do efeito.
  const ultimaRef = useRef<string | null>(null);

  const revisar = useCallback(
    async (codigo?: string | null): Promise<ResultadoRevisarCarrinho> => {
      const chave = chaveRevisao(itens, codigo);
      ultimaRef.current = chave;
      const r = await revisarCarrinhoAction({
        loja_id: lojaId,
        ...(codigo ? { codigo } : {}),
        itens: itensParaRevisao(itens),
      });
      if (ultimaRef.current !== chave) return r;
      if (r.ok) setEntrada({ chave, dados: r });
      // Falhou: solta a dedupe para que a próxima mudança (ou um novo clique)
      // possa tentar de novo em vez de ficar presa a uma chave sem resposta.
      else ultimaRef.current = null;
      return r;
    },
    [lojaId, itens],
  );

  const chaveAtual = chaveRevisao(itens, codigoCupom);

  useEffect(() => {
    if (!ativo || itens.length === 0) return;
    // Já disparada para ESTA chave (inclusive pela validação de cupom, que usa
    // o mesmo `revisar`): não repete.
    if (ultimaRef.current === chaveAtual) return;
    const id = setTimeout(() => {
      void revisar(codigoCupom);
    }, ATRASO_REVISAO_MS);
    return () => clearTimeout(id);
    // `chaveAtual` (string) no lugar de `itens` (array): a dependência é o
    // CONTEÚDO do carrinho + o cupom, não a identidade do array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, chaveAtual, lojaId]);

  return {
    revisao: entrada?.dados ?? null,
    revisaoFresca: revisaoFrescaDe(entrada, chaveAtual),
    revisar,
  };
}
