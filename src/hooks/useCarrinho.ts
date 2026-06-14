"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ItemCarrinho, OpcionalCarrinho } from "@/types/dominio";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";

// Escopo por session (não por loja): o carrinho mantém uma loja por vez.
const CHAVE_STORAGE = "irango:carrinho";

/**
 * Assinatura estável de UMA linha do carrinho = produtoId + opcionais escolhidos
 * (id:qtd, ordenados). Duas adições do mesmo produto com opcionais DIFERENTES
 * geram assinaturas diferentes → linhas distintas; mesmo produto + mesmos
 * opcionais → soma a quantidade (dedup). A ordenação torna a chave estável
 * independente da ordem em que os opcionais foram escolhidos.
 */
export function linhaCarrinhoId(
  produtoId: string,
  opcionais?: OpcionalCarrinho[],
): string {
  const assinatura = (opcionais ?? [])
    .filter((o) => o.quantidade > 0)
    .map((o) => `${o.opcionalId}:${o.quantidade}`)
    .sort()
    .join(",");
  return assinatura ? `${produtoId}|${assinatura}` : produtoId;
}

export type UseCarrinhoReturn = {
  itens: ItemCarrinho[];
  adicionar: (item: Omit<ItemCarrinho, "quantidade">, quantidade?: number) => void;
  /** `id` = `linhaCarrinhoId(...)`. Retrocompat: aceita `produtoId` puro (linha sem opcionais). */
  incrementar: (id: string) => void;
  decrementar: (id: string) => void; // remove ao chegar em 0
  remover: (id: string) => void;
  limpar: () => void;
  subtotal: number; // preview — soma de (preco + Σ opcionais) * quantidade (UX, nunca enviado ao servidor)
  totalItens: number; // soma de quantidades
};

/** Lê o carrinho do sessionStorage de forma defensiva (SSR-safe). */
function lerStorage(): ItemCarrinho[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_STORAGE);
    if (!bruto) return [];
    const parsed = JSON.parse(bruto);
    return Array.isArray(parsed) ? (parsed as ItemCarrinho[]) : [];
  } catch {
    return [];
  }
}

/**
 * Estado do carrinho no client com persistência em sessionStorage.
 * Os valores monetários (`subtotal`) são PREVIEW de UX — o servidor recalcula
 * tudo a partir do banco (seguranca.md §10).
 */
export function useCarrinho(): UseCarrinhoReturn {
  // Inicializa a partir do sessionStorage no primeiro render → sobrevive a refresh.
  const [itens, setItens] = useState<ItemCarrinho[]>(lerStorage);

  // Sincroniza para o sessionStorage sempre que os itens mudam.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(CHAVE_STORAGE, JSON.stringify(itens));
    } catch {
      // Storage indisponível (modo privado/cota) — degrada para estado em memória.
    }
  }, [itens]);

  // `quantidade` default 1 → retrocompat com chamadas antigas. A dedup considera
  // produto + assinatura de opcionais (linhaCarrinhoId): mesmo produto com os
  // MESMOS opcionais soma a quantidade; com opcionais diferentes vira linha nova.
  const adicionar = useCallback(
    (item: Omit<ItemCarrinho, "quantidade">, quantidade = 1) => {
      const qtd = Math.max(1, Math.floor(quantidade));
      const chave = linhaCarrinhoId(item.produtoId, item.opcionais);
      setItens((atual) => {
        const existe = atual.some(
          (i) => linhaCarrinhoId(i.produtoId, i.opcionais) === chave,
        );
        if (existe) {
          return atual.map((i) =>
            linhaCarrinhoId(i.produtoId, i.opcionais) === chave
              ? { ...i, quantidade: i.quantidade + qtd }
              : i,
          );
        }
        return [...atual, { ...item, quantidade: qtd }];
      });
    },
    [],
  );

  const incrementar = useCallback((id: string) => {
    setItens((atual) =>
      atual.map((i) =>
        linhaCarrinhoId(i.produtoId, i.opcionais) === id
          ? { ...i, quantidade: i.quantidade + 1 }
          : i,
      ),
    );
  }, []);

  const decrementar = useCallback((id: string) => {
    setItens((atual) =>
      atual
        .map((i) =>
          linhaCarrinhoId(i.produtoId, i.opcionais) === id
            ? { ...i, quantidade: i.quantidade - 1 }
            : i,
        )
        .filter((i) => i.quantidade > 0),
    );
  }, []);

  const remover = useCallback((id: string) => {
    setItens((atual) =>
      atual.filter((i) => linhaCarrinhoId(i.produtoId, i.opcionais) !== id),
    );
  }, []);

  const limpar = useCallback(() => {
    setItens([]);
  }, []);

  // Preview de UX — recalculado no render, nunca enviado ao servidor como valor.
  // Reusa calcularSubtotal (082): (preco + Σ opcional.preco×qtd) × quantidade.
  const subtotal = useMemo(
    () =>
      calcularSubtotal(
        itens.map((i) => ({
          preco: i.preco,
          quantidade: i.quantidade,
          opcionais: i.opcionais?.map((o) => ({
            preco: o.preco,
            quantidade: o.quantidade,
          })),
        })),
      ),
    [itens],
  );

  const totalItens = useMemo(
    () => itens.reduce((acc, i) => acc + i.quantidade, 0),
    [itens],
  );

  return {
    itens,
    adicionar,
    incrementar,
    decrementar,
    remover,
    limpar,
    subtotal,
    totalItens,
  };
}
