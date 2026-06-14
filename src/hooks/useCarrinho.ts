"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

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

// ─────────────────────────── store de módulo ─────────────────────────────────
// Estado ÚNICO compartilhado por todas as instâncias de useCarrinho (catálogo,
// barra inferior, drawer, wizard). Sem isto, cada componente teria seu próprio
// useState e a adição no catálogo não apareceria no carrinho sem refresh.
// useSyncExternalStore garante re-render de todos os assinantes a cada mutação.

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

// Snapshot atual (referência estável até uma mutação substituí-la — requisito do
// useSyncExternalStore: getSnapshot deve retornar o MESMO ref se nada mudou).
let estado: ItemCarrinho[] = lerStorage();
const ouvintes = new Set<() => void>();
const VAZIO: ItemCarrinho[] = []; // snapshot estável no SSR

function emitir(proximo: ItemCarrinho[]): void {
  estado = proximo;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(CHAVE_STORAGE, JSON.stringify(estado));
    } catch {
      // Storage indisponível (modo privado/cota) — degrada para memória.
    }
  }
  ouvintes.forEach((fn) => fn());
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  // Sincroniza entre abas: outra aba grava no sessionStorage → reflete aqui.
  const aoStorage = (e: StorageEvent) => {
    if (e.key === CHAVE_STORAGE) {
      estado = lerStorage();
      ouvintes.forEach((fn) => fn());
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", aoStorage);
  }
  return () => {
    ouvintes.delete(ouvinte);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", aoStorage);
    }
  };
}

// Mutadores: operam sobre o estado de módulo e emitem (novo array sempre que muda).
function adicionarItem(
  item: Omit<ItemCarrinho, "quantidade">,
  quantidade = 1,
): void {
  const qtd = Math.max(1, Math.floor(quantidade));
  const chave = linhaCarrinhoId(item.produtoId, item.opcionais);
  const existe = estado.some(
    (i) => linhaCarrinhoId(i.produtoId, i.opcionais) === chave,
  );
  if (existe) {
    emitir(
      estado.map((i) =>
        linhaCarrinhoId(i.produtoId, i.opcionais) === chave
          ? { ...i, quantidade: i.quantidade + qtd }
          : i,
      ),
    );
  } else {
    emitir([...estado, { ...item, quantidade: qtd }]);
  }
}

function incrementarItem(id: string): void {
  emitir(
    estado.map((i) =>
      linhaCarrinhoId(i.produtoId, i.opcionais) === id
        ? { ...i, quantidade: i.quantidade + 1 }
        : i,
    ),
  );
}

function decrementarItem(id: string): void {
  emitir(
    estado
      .map((i) =>
        linhaCarrinhoId(i.produtoId, i.opcionais) === id
          ? { ...i, quantidade: i.quantidade - 1 }
          : i,
      )
      .filter((i) => i.quantidade > 0),
  );
}

function removerItem(id: string): void {
  emitir(estado.filter((i) => linhaCarrinhoId(i.produtoId, i.opcionais) !== id));
}

function limparItens(): void {
  emitir([]);
}

/**
 * Estado do carrinho no client, COMPARTILHADO entre componentes via store de
 * módulo + useSyncExternalStore, com persistência em sessionStorage.
 * Os valores monetários (`subtotal`) são PREVIEW de UX — o servidor recalcula
 * tudo a partir do banco (seguranca.md §10).
 */
export function useCarrinho(): UseCarrinhoReturn {
  const itens = useSyncExternalStore(
    inscrever,
    () => estado,
    () => VAZIO, // getServerSnapshot — carrinho nasce vazio no SSR
  );

  const adicionar = useCallback(
    (item: Omit<ItemCarrinho, "quantidade">, quantidade = 1) =>
      adicionarItem(item, quantidade),
    [],
  );
  const incrementar = useCallback((id: string) => incrementarItem(id), []);
  const decrementar = useCallback((id: string) => decrementarItem(id), []);
  const remover = useCallback((id: string) => removerItem(id), []);
  const limpar = useCallback(() => limparItens(), []);

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
