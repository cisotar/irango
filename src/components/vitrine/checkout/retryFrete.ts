// STUB TDD (fase RED, issue 180-B) — a implementação é da fase GREEN
// (`executar`), conforme plan/180-B §D8.
//
// Módulo NEUTRO (sem "use client"/"use server", igual a `estado.ts` e
// `aberturaWhatsapp.ts`): só a MECÂNICA TEMPORAL do retry do preview de frete,
// com o relógio INJETADO por parâmetro — o repo não tem jsdom, então nada de
// `setTimeout` global aqui.
//
// O relógio é 100% CLIENTE e NÃO é autoridade sobre nada (mandato 1): o
// servidor não conta tentativa, não guarda estado de retry e recalcula o valor
// do zero em `criarPedido`. O único efeito deste módulo é QUANDO o cliente
// pede de novo — nunca QUANTO ele paga.

import type { VereditoACombinar } from "@/lib/utils/freteDegradado";

/**
 * t=10s e t=20s a partir da chamada que ABRIU o modal (decisão do usuário: essa
 * chamada já é a tentativa 1; o cliente faz mais 2 — total 3).
 */
export const ATRASOS_RETRY_MS = [10_000, 10_000] as const;

/**
 * Resultado de uma tentativa, no shape que `calcularFreteAction` devolve.
 * CONTRATO para a fase GREEN: trocar por `ResultadoFretePreview` importado de
 * `@/lib/actions/frete` assim que aquele union ganhar a variante `a_combinar`.
 */
export type ResultadoTentativaFrete =
  | { ok: true; taxa_preview: number; zona_nome: string }
  | { ok: true; a_combinar: true; veredito: VereditoACombinar }
  | { ok: false; erro: string };

export type FaseRetry = "aguardando" | "tentando" | "sucesso" | "esgotado";

export type EstadoRetry = { tentativa: 1 | 2 | 3; fase: FaseRetry };

export interface DepsRetryFrete {
  /** Re-chama `calcularFreteAction` — uma chamada nova e independente. */
  tentar: () => Promise<ResultadoTentativaFrete>;
  /** `setTimeout` injetado. */
  agendar: (fn: () => void, ms: number) => number;
  /** `clearTimeout` injetado. */
  cancelar: (id: number) => void;
  /** Notifica a UI (spinner, "tentativa 2 de 3", passo 3). */
  aoEstado: (e: EstadoRetry) => void;
}

export interface ControladorRetryFrete {
  /**
   * Arranca o relógio a partir do veredito que ABRIU o modal.
   * Só `a_combinar_retriavel` agenda: `a_combinar_esgotado` e
   * `a_combinar_cep` vão direto ao passo 3, sem spinner e sem consumir
   * tentativa.
   */
  iniciar: (vereditoInicial: VereditoACombinar) => void;
  /** Unmount / troca de etapa: limpa o timer pendente. Idempotente. */
  parar: () => void;
}

export function criarRetryFrete(
  _deps: DepsRetryFrete,
): ControladorRetryFrete {
  throw new Error("TODO: GREEN (180-B)");
}
