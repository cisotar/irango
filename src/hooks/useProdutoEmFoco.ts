"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { ProdutoModalDados } from "@/components/vitrine/ProdutoModal";

/**
 * De onde partiu a abertura do detalhe. Não muda o CONTEÚDO do modal — decide
 * só para onde o foco volta quando ele fecha (RN-6/289): vindo da promoção, o
 * botão que abriu já não existe, então o destino é o `<main>`.
 */
export type OrigemProdutoEmFoco = "catalogo" | "promocoes";

export type ProdutoEmFoco = {
  /** O produto do modal, INTEIRO e já montado no servidor/no catálogo. */
  dados: ProdutoModalDados | null;
  aberto: boolean;
  origem: OrigemProdutoEmFoco;
};

// ─────────────────────────── store de módulo ─────────────────────────────────
// Mesma forma do `useCarrinho` (store de módulo + useSyncExternalStore), pelo
// mesmo motivo: `ModalPromocoes` (em `VitrineClient`) e o `ProdutoModal` (em
// `SecaoCatalogo`) são IRMÃOS sob um Server Component e não compartilham
// estado. A diferença é deliberada: aqui NÃO há persistência — qual produto
// está em foco é estado de UX efêmero, e persistir abriria modal sozinho no
// próximo acesso (RN-12/289).
//
// Nada de monetário é decidido aqui: o objeto guardado é o `ProdutoVitrine` que
// o servidor projetou, e o valor cobrado continua recalculado na Server Action
// do checkout a partir do banco (seguranca.md §10).

/** Snapshot estável do estado fechado — serve o SSR e o `zerar()`. */
const FECHADO: ProdutoEmFoco = {
  dados: null,
  aberto: false,
  origem: "catalogo",
};

let estado: ProdutoEmFoco = FECHADO;
const ouvintes = new Set<() => void>();

function emitir(proximo: ProdutoEmFoco): void {
  estado = proximo;
  ouvintes.forEach((fn) => fn());
}

export function subscribe(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function getSnapshot(): ProdutoEmFoco {
  return estado;
}

/** Nada no SSR: o modal de detalhe nasce fechado (mesma trava do carrinho). */
export function getServerSnapshot(): ProdutoEmFoco {
  return FECHADO;
}

/**
 * Põe UM produto em foco. Chamar de novo SUBSTITUI o anterior — nunca existem
 * dois produtos em disputa pelo modal único.
 */
export function abrirProdutoEmFoco(
  dados: ProdutoModalDados,
  origem: OrigemProdutoEmFoco = "catalogo",
): void {
  emitir({ dados, aberto: true, origem });
}

/**
 * Fecha o modal MANTENDO a identidade do produto: o Base UI ainda anima a
 * saída lendo o conteúdo, e trocar `dados` para `null` aqui esvaziaria o popup
 * no meio da animação. A próxima abertura substitui.
 */
export function fecharProdutoEmFoco(): void {
  if (!estado.aberto) return;
  emitir({ ...estado, aberto: false });
}

/**
 * Zera o store por completo (RN-12): usado no desmonte de quem renderiza o
 * modal, para que uma navegação client-side para OUTRA loja não encontre um
 * produto pendente da loja anterior.
 */
export function zerarProdutoEmFoco(): void {
  if (estado === FECHADO) return;
  emitir(FECHADO);
}

export type UseProdutoEmFocoReturn = ProdutoEmFoco & {
  abrir: (dados: ProdutoModalDados, origem?: OrigemProdutoEmFoco) => void;
  fechar: () => void;
};

/**
 * Qual produto está em foco no `ProdutoModal` da vitrine — fonte ÚNICA,
 * compartilhada entre o catálogo e o modal de promoções (D1/289).
 */
export function useProdutoEmFoco(): UseProdutoEmFocoReturn {
  const foco = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const abrir = useCallback(
    (dados: ProdutoModalDados, origem: OrigemProdutoEmFoco = "catalogo") =>
      abrirProdutoEmFoco(dados, origem),
    [],
  );
  const fechar = useCallback(() => fecharProdutoEmFoco(), []);

  return { ...foco, abrir, fechar };
}
