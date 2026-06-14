"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ItemCarrinho } from "@/types/dominio";

// Escopo por session (não por loja): o carrinho mantém uma loja por vez.
const CHAVE_STORAGE = "irango:carrinho";

export type UseCarrinhoReturn = {
  itens: ItemCarrinho[];
  adicionar: (item: Omit<ItemCarrinho, "quantidade">, quantidade?: number) => void;
  incrementar: (produtoId: string) => void;
  decrementar: (produtoId: string) => void; // remove ao chegar em 0
  remover: (produtoId: string) => void;
  limpar: () => void;
  subtotal: number; // preview — soma de preco * quantidade (UX, nunca enviado ao servidor)
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

  // `quantidade` default 1 → retrocompat com chamadas antigas. Se o item já existe,
  // soma a quantidade; senão, insere com a quantidade pedida (mínimo 1).
  const adicionar = useCallback(
    (item: Omit<ItemCarrinho, "quantidade">, quantidade = 1) => {
      const qtd = Math.max(1, Math.floor(quantidade));
      setItens((atual) => {
        const existente = atual.find((i) => i.produtoId === item.produtoId);
        if (existente) {
          return atual.map((i) =>
            i.produtoId === item.produtoId
              ? { ...i, quantidade: i.quantidade + qtd }
              : i,
          );
        }
        return [...atual, { ...item, quantidade: qtd }];
      });
    },
    [],
  );

  const incrementar = useCallback((produtoId: string) => {
    setItens((atual) =>
      atual.map((i) =>
        i.produtoId === produtoId ? { ...i, quantidade: i.quantidade + 1 } : i,
      ),
    );
  }, []);

  const decrementar = useCallback((produtoId: string) => {
    setItens((atual) =>
      atual
        .map((i) =>
          i.produtoId === produtoId ? { ...i, quantidade: i.quantidade - 1 } : i,
        )
        .filter((i) => i.quantidade > 0),
    );
  }, []);

  const remover = useCallback((produtoId: string) => {
    setItens((atual) => atual.filter((i) => i.produtoId !== produtoId));
  }, []);

  const limpar = useCallback(() => {
    setItens([]);
  }, []);

  // Preview de UX — recalculado no render, nunca enviado ao servidor como valor.
  const subtotal = useMemo(
    () => itens.reduce((acc, i) => acc + i.preco * i.quantidade, 0),
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
