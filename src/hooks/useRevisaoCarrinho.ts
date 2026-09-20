"use client";

// [237/238] A ÚNICA porta do cliente para `revisarCarrinhoAction`.
//
// Existe para que o resumo do checkout e a gaveta do carrinho não tenham dois
// caminhos diferentes até os mesmos números — e para que a revisão automática
// (RN-12, camada 1: "ao entrar na etapa final do checkout") seja deduplicada
// pela ASSINATURA do carrinho: o rate limit por IP é compartilhado com o
// cupom, e uma chamada por render o esgotaria por conta de UX.
//
// 🛑 Nada é calculado aqui. `subtotal`, `economiaProdutos`, os preços por linha
// e o estado A/B/C do cupom chegam PRONTOS do servidor (RN-11 / D5-b). Falha
// de revisão degrada em silêncio: `revisao` fica `null` e a UI simplesmente
// não renderiza as linhas que dependem desses números.

import { useCallback, useEffect, useRef, useState } from "react";

import { revisarCarrinhoAction } from "@/lib/actions/revisarCarrinho";
import type { ResultadoRevisarCarrinho } from "@/lib/actions/revisarCarrinho-contrato";
import { assinaturaCarrinho, itensParaRevisao } from "@/lib/utils/itensRevisao";
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
  const [revisao, setRevisao] = useState<RevisaoCarrinho | null>(null);
  // Guarda a última requisição disparada: uma resposta antiga que chega depois
  // de o carrinho mudar não pode sobrescrever a nova.
  const ultimaRef = useRef<string | null>(null);

  const revisar = useCallback(
    async (codigo?: string | null): Promise<ResultadoRevisarCarrinho> => {
      const chave = `${assinaturaCarrinho(itens)}|${codigo ?? ""}`;
      ultimaRef.current = chave;
      const r = await revisarCarrinhoAction({
        loja_id: lojaId,
        ...(codigo ? { codigo } : {}),
        itens: itensParaRevisao(itens),
      });
      if (r.ok && ultimaRef.current === chave) setRevisao(r);
      return r;
    },
    [lojaId, itens],
  );

  const assinatura = assinaturaCarrinho(itens);

  useEffect(() => {
    if (!ativo || itens.length === 0) return;
    void revisar(codigoCupom);
    // `assinatura` (string) no lugar de `itens` (array): a dependência é o
    // CONTEÚDO do carrinho, não a identidade do array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, assinatura, codigoCupom, lojaId]);

  return { revisao, revisar };
}
