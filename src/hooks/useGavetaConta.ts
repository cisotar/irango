"use client";

import { useSyncExternalStore } from "react";

/**
 * De onde a gaveta "Sua conta" foi aberta. "finalizar" (pelo carrinho) troca o
 * destino do login para `/pedido` e mostra "Prosseguir sem login".
 */
export type OrigemGavetaConta = "menu" | "finalizar";

export type GavetaConta = { aberta: boolean; origem: OrigemGavetaConta };

// Store de módulo, mesmo molde do `useProdutoEmFoco`: o ☰ (no `HeaderLoja`) e o
// "Finalizar pedido" (no `Carrinho`, dentro do `VitrineClient`) são irmãos sob
// um Server Component e abrem a MESMA gaveta. Sem persistência.

const FECHADA: GavetaConta = { aberta: false, origem: "menu" };

let estado: GavetaConta = FECHADA;
const ouvintes = new Set<() => void>();

function emitir(proximo: GavetaConta): void {
  estado = proximo;
  ouvintes.forEach((fn) => fn());
}

export function subscribe(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function getSnapshot(): GavetaConta {
  return estado;
}

export function getServerSnapshot(): GavetaConta {
  return FECHADA;
}

export function abrirGavetaConta(origem: OrigemGavetaConta): void {
  emitir({ aberta: true, origem });
}

/** Fecha mantendo a origem: o conteúdo não troca no meio da animação de saída. */
export function fecharGavetaConta(): void {
  if (!estado.aberta) return;
  emitir({ ...estado, aberta: false });
}

/** No desmonte da vitrine: navegar para outra loja não herda gaveta aberta. */
export function zerarGavetaConta(): void {
  if (estado === FECHADA) return;
  emitir(FECHADA);
}

export function useGavetaConta(): GavetaConta {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
