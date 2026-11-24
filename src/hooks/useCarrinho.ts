"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { ItemCarrinho, OpcionalCarrinho } from "@/types/dominio";
import { MAX_ITENS_PEDIDO } from "@/lib/constants/pedido";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import { canonizarObservacao } from "@/lib/utils/normalizarObservacao";

// Escopo por sessão E por loja (371): um carrinho isolado por `lojaId` (uuid —
// nunca slug, que é mutável, nem dado do cliente). Antes era uma chave global e
// o sessionStorage copiado ao abrir aba por link fazia a loja B mostrar os
// itens da loja A.
const PREFIXO_CHAVE = "irango:carrinho:";
/** Chave global anterior à 371: conteúdo descartado, nunca adotado (loja desconhecida). */
const CHAVE_LEGADA = "irango:carrinho";

export function chaveCarrinho(lojaId: string): string {
  return `${PREFIXO_CHAVE}${lojaId}`;
}

/**
 * Assinatura estável de UMA linha do carrinho = produtoId + opcionais escolhidos
 * (id:qtd, ordenados) + observação canônica. Duas adições do mesmo produto com
 * opcionais OU observações DIFERENTES geram chaves diferentes → linhas
 * distintas; mesmo produto + mesmos opcionais + mesma observação → soma a
 * quantidade (dedup). A ordenação torna a chave estável independente da ordem
 * em que os opcionais foram escolhidos.
 *
 * Três formas, nesta ordem (issue 168 — as duas primeiras são RETROCOMPAT byte
 * a byte, há código de produção apoiado nelas):
 *   1. sem opcionais e sem observação → `produtoId`
 *   2. com opcionais e sem observação → `produtoId|assinatura`
 *   3. com observação                 → `produtoId|assinatura|obs`
 *
 * Injetividade: `produtoId` (uuid) e `assinatura` (`uuid:int` separado por
 * vírgula) NUNCA contêm `|`; só `obs` é texto livre e é o ÚLTIMO segmento,
 * sempre após exatamente dois `|`. Logo nenhuma observação adversa forja a
 * chave de outra linha — é o que impede fusão (cliente paga menos) ou cisão
 * (cliente paga mais) indevida de quantidade.
 *
 * A chave usa o texto CANÔNICO (`canonizarObservacao`, a mesma normalização do
 * `schemaObservacao` do servidor): a identidade da linha no cliente é exatamente
 * a que a RPC vai persistir, e espaço/invisível repetido não vira linha nova.
 */
export function linhaCarrinhoId(
  produtoId: string,
  opcionais?: OpcionalCarrinho[],
  observacao?: string,
): string {
  const assinatura = (opcionais ?? [])
    .filter((o) => o.quantidade > 0)
    .map((o) => `${o.opcionalId}:${o.quantidade}`)
    .sort()
    .join(",");
  const obs = canonizarObservacao(observacao ?? "");
  if (!obs) return assinatura ? `${produtoId}|${assinatura}` : produtoId;
  return `${produtoId}|${assinatura}|${obs}`;
}

export type UseCarrinhoReturn = {
  itens: ItemCarrinho[];
  adicionar: (item: Omit<ItemCarrinho, "quantidade">, quantidade?: number) => void;
  /** `id` = `linhaCarrinhoId(...)`. Retrocompat: aceita `produtoId` puro (linha sem opcionais e sem observação). */
  incrementar: (id: string) => void;
  decrementar: (id: string) => void; // remove ao chegar em 0
  remover: (id: string) => void;
  limpar: () => void;
  subtotal: number; // preview — soma de (preco × quantidade) + Σ opcionais (opcional por linha, UX, nunca enviado ao servidor)
  totalItens: number; // soma de quantidades
};

// ─────────────────────────── store de módulo ─────────────────────────────────
// Um estado POR LOJA compartilhado por todas as instâncias de useCarrinho dessa
// loja (catálogo, barra inferior, drawer, wizard). Sem isto, cada componente
// teria seu próprio useState e a adição no catálogo não apareceria no carrinho
// sem refresh. useSyncExternalStore garante re-render dos assinantes a cada
// mutação.

/** Lê o carrinho de UMA loja do sessionStorage de forma defensiva (SSR-safe). */
function lerStorage(lojaId: string): ItemCarrinho[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = window.sessionStorage.getItem(chaveCarrinho(lojaId));
    if (!bruto) return [];
    const parsed = JSON.parse(bruto);
    return Array.isArray(parsed) ? (parsed as ItemCarrinho[]) : [];
  } catch {
    return [];
  }
}

/** Remove a chave global legada — igualdade exata, nunca prefixo. Best-effort. */
function descartarLegado(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHAVE_LEGADA);
  } catch {
    // Storage indisponível — nada a limpar.
  }
}
descartarLegado();

// Snapshot por loja (referência estável até uma mutação substituí-la — requisito
// do useSyncExternalStore: getSnapshot deve retornar o MESMO ref se nada mudou).
const estados = new Map<string, ItemCarrinho[]>();
const ouvintes = new Set<() => void>();
const VAZIO: ItemCarrinho[] = []; // snapshot estável no SSR

function estadoDe(lojaId: string): ItemCarrinho[] {
  let atual = estados.get(lojaId);
  if (atual === undefined) {
    atual = lerStorage(lojaId);
    estados.set(lojaId, atual);
  }
  return atual;
}

function emitir(lojaId: string, proximo: ItemCarrinho[]): void {
  estados.set(lojaId, proximo);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(chaveCarrinho(lojaId), JSON.stringify(proximo));
    } catch {
      // Storage indisponível (modo privado/cota) — degrada para memória.
    }
  }
  ouvintes.forEach((fn) => fn());
}

function inscrever(lojaId: string) {
  return (ouvinte: () => void): (() => void) => {
    ouvintes.add(ouvinte);
    // Sincroniza entre abas: outra aba grava no sessionStorage → reflete aqui.
    const aoStorage = (e: StorageEvent) => {
      if (e.key === chaveCarrinho(lojaId)) {
        estados.set(lojaId, lerStorage(lojaId));
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
  };
}

// Mutadores: operam sobre o estado de módulo e emitem (novo array sempre que muda).
function adicionarItem(
  lojaId: string,
  item: Omit<ItemCarrinho, "quantidade">,
  quantidade = 1,
): void {
  const qtd = Math.max(1, Math.floor(quantidade));
  // Fronteira: o estado guarda a observação JÁ canonizada, e OMITE o campo
  // quando ela é vazia — assim `chave(item) === chave(canonizar(item))` para
  // todo item guardado e a linha não muda de identidade entre dois renders.
  const observacao = canonizarObservacao(item.observacao ?? "");
  const normalizado: Omit<ItemCarrinho, "quantidade"> = { ...item };
  if (observacao) normalizado.observacao = observacao;
  else delete normalizado.observacao;

  const chave = linhaCarrinhoId(
    normalizado.produtoId,
    normalizado.opcionais,
    normalizado.observacao,
  );
  const estado = estadoDe(lojaId);
  const existe = estado.some(
    (i) => linhaCarrinhoId(i.produtoId, i.opcionais, i.observacao) === chave,
  );
  if (existe) {
    emitir(
      lojaId,
      estado.map((i) =>
        linhaCarrinhoId(i.produtoId, i.opcionais, i.observacao) === chave
          ? { ...i, quantidade: i.quantidade + qtd }
          : i,
      ),
    );
  } else {
    // Teto de LINHAS (172): `schemaPayloadPedido.itens` rejeita o pedido inteiro
    // acima de MAX_ITENS_PEDIDO, então criar a linha excedente deixaria o
    // carrinho não-submetível sem nada explicando no checkout. Incrementar linha
    // existente (ramo acima) não cria linha e não é afetado. Descarta em
    // silêncio de propósito: quem chama (ProdutoModal) checa o teto ANTES pelo
    // `itens` do hook e avisa o cliente; esta é a trava de último recurso.
    if (estado.length >= MAX_ITENS_PEDIDO) return;
    emitir(lojaId, [...estado, { ...normalizado, quantidade: qtd }]);
  }
}

function incrementarItem(lojaId: string, id: string): void {
  emitir(
    lojaId,
    estadoDe(lojaId).map((i) =>
      linhaCarrinhoId(i.produtoId, i.opcionais, i.observacao) === id
        ? { ...i, quantidade: i.quantidade + 1 }
        : i,
    ),
  );
}

function decrementarItem(lojaId: string, id: string): void {
  emitir(
    lojaId,
    estadoDe(lojaId)
      .map((i) =>
        linhaCarrinhoId(i.produtoId, i.opcionais, i.observacao) === id
          ? { ...i, quantidade: i.quantidade - 1 }
          : i,
      )
      .filter((i) => i.quantidade > 0),
  );
}

function removerItem(lojaId: string, id: string): void {
  emitir(
    lojaId,
    estadoDe(lojaId).filter(
      (i) => linhaCarrinhoId(i.produtoId, i.opcionais, i.observacao) !== id,
    ),
  );
}

function limparItens(lojaId: string): void {
  emitir(lojaId, []);
}

/**
 * Zera o carrinho de UMA loja — memória, storage e assinantes. Usada após o
 * pedido criado: limpar só o storage deixaria o `Map` do módulo com os itens, e
 * a navegação no cliente de volta à loja os traria de volta (e os regravaria).
 */
export function limparCarrinho(lojaId: string): void {
  limparItens(lojaId);
}

/**
 * Estado do carrinho no client, COMPARTILHADO entre componentes via store de
 * módulo + useSyncExternalStore, com persistência em sessionStorage.
 * Os valores monetários (`subtotal`) são PREVIEW de UX — o servidor recalcula
 * tudo a partir do banco (seguranca.md §10).
 */
export function useCarrinho(lojaId: string): UseCarrinhoReturn {
  const assinar = useMemo(() => inscrever(lojaId), [lojaId]);
  const itens = useSyncExternalStore(
    assinar,
    () => estadoDe(lojaId),
    () => VAZIO, // getServerSnapshot — carrinho nasce vazio no SSR
  );

  const adicionar = useCallback(
    (item: Omit<ItemCarrinho, "quantidade">, quantidade = 1) =>
      adicionarItem(lojaId, item, quantidade),
    [lojaId],
  );
  const incrementar = useCallback((id: string) => incrementarItem(lojaId, id), [lojaId]);
  const decrementar = useCallback((id: string) => decrementarItem(lojaId, id), [lojaId]);
  const remover = useCallback((id: string) => removerItem(lojaId, id), [lojaId]);
  const limpar = useCallback(() => limparItens(lojaId), [lojaId]);

  // Preview de UX — recalculado no render, nunca enviado ao servidor como valor.
  // Reusa calcularSubtotal (082/090): (preco × quantidade) + Σ opcional.preco×qtd
  // (opcional por linha, não multiplica pela qtd do produto).
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
