import { timingSafeEqual } from "node:crypto";
import type { EventoHotmart } from "./assinatura";

/**
 * Módulo de ADAPTAÇÃO do contrato externo Hotmart (issue 057). Funções PURAS,
 * sem I/O — todo ponto que depende do formato exato do payload da Hotmart fica
 * isolado aqui, marcado `// TODO: confirmar doc Hotmart`. Trocar o contrato
 * externo (ex.: header→HMAC) muda só este arquivo, nunca o handler.
 */

/** Nome lógico interno do evento (reusa o union de assinatura.ts — 056). */
export type EventoLogico = EventoHotmart;

/**
 * Comparação tempo-constante do hottok recebido contra o segredo esperado (D1,
 * RN-A2). NUNCA usa `===` (vaza timing). NUNCA lança — comprimentos diferentes
 * retornam `false` (timingSafeEqual exige buffers de igual tamanho). Sem segredo
 * configurado → `false` (nunca autoriza às cegas).
 */
export function validarHottok(
  recebido: string | null,
  esperado: string | undefined,
): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  // Guarda de comprimento: timingSafeEqual lança se os tamanhos diferem.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Id canônico do evento p/ idempotência (D2). Primário `payload.id`; fallback
 * determinístico `${transaction}:${event}`; nenhum dos dois → `null` (handler
 * responde 400 — sem id não há trava de idempotência).
 * // TODO: confirmar doc Hotmart (caminho de `id` e `data.purchase.transaction`).
 */
export function extrairEventoId(payload: unknown): string | null {
  const p = asObjeto(payload);
  if (!p) return null;
  if (typeof p.id === "string" && p.id.length > 0) return p.id;

  const event = typeof p.event === "string" ? p.event : null;
  const data = asObjeto(p.data);
  const purchase = data ? asObjeto(data.purchase) : null;
  const transaction =
    purchase && typeof purchase.transaction === "string" ? purchase.transaction : null;
  if (transaction && event) return `${transaction}:${event}`;
  return null;
}

// Mapa nome externo Hotmart → nome lógico interno (consumido por eventoParaStatus
// em assinatura.ts). // TODO: confirmar nomes EXATOS na doc oficial Hotmart.
const MAPA_EVENTO_EXTERNO: Record<string, EventoLogico> = {
  PURCHASE_APPROVED: "compra_aprovada",
  PURCHASE_COMPLETE: "compra_aprovada",
  SUBSCRIPTION_CANCELLATION: "cancelamento",
  PURCHASE_REFUNDED: "reembolso",
  PURCHASE_CHARGEBACK: "chargeback",
  PURCHASE_DELAYED: "inadimplencia",
  // Recorrência aprovada (renovação automática do ciclo).
  PURCHASE_BILLET_PRINTED: "recorrencia_aprovada",
};

/**
 * Traduz o nome externo do evento para o nome lógico interno. Evento
 * desconhecido → `null` (o handler grava p/ auditoria e responde 2xx, NÃO muda
 * o estado da assinatura).
 */
export function mapearEventoHotmart(nomeExterno: string): EventoLogico | null {
  return MAPA_EVENTO_EXTERNO[nomeExterno] ?? null;
}

/**
 * Fim do período de assinatura (D3). PURA: `agora` injetado. Usa a data de
 * próxima cobrança da Hotmart se presente e parseável; senão fallback
 * `agora + 30 dias` — nunca grava Invalid Date nem data no passado.
 * // TODO: confirmar doc Hotmart (caminho de `data.purchase.date_next_charge`).
 */
export function calcularFimPeriodo(payloadFim: unknown, agora: Date): Date {
  if (payloadFim !== undefined && payloadFim !== null) {
    const candidato = new Date(payloadFim as string | number | Date);
    if (!Number.isNaN(candidato.getTime())) return candidato;
  }
  const fallback = new Date(agora.getTime());
  fallback.setDate(fallback.getDate() + 30);
  return fallback;
}
