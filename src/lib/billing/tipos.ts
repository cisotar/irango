import "server-only";
import type { EventoBilling } from "@/lib/utils/assinatura";
import type { DadosPagamentoBilling } from "./providers/asaas";

/**
 * Contrato AGNÓSTICO do adapter de billing (issue 076). Toda a especificidade de
 * um provider (Asaas — DA-1) vive atrás desta interface; o webhook (077) e as
 * Server Actions (078) consomem `BillingProvider` sem saber qual provider está
 * ativo. `getBillingProvider(BILLING_PROVIDER)` resolve o objeto concreto.
 */

export type DadosEventoBilling = {
  eventoId: string;
  tipo: EventoBilling | null;
  providerSubscriptionId: string | null;
  pagamento: DadosPagamentoBilling | null;
  proximaCobranca: unknown;
};

/**
 * Loja mínima passada às operações de intenção (078) — o provider precisa de
 * identidade (`id` para `externalReference`) e contato (criar o customer no
 * provider). AGNÓSTICO: nenhum campo provider-específico.
 */
export type LojaParaProvider = {
  id: string;
  nome: string;
  email: string;
};

/** Plano mínimo (catálogo) passado às operações de intenção (078). */
export type PlanoParaProvider = {
  id: string;
  intervalo: string;
  provider_price_id: string | null;
};

/**
 * Parâmetros AGNÓSTICOS de criação/troca de assinatura (078). `value` é o preço
 * AUTORITATIVO lido de `planos.preco` no banco pela Server Action (RN-1) — nunca
 * do cliente. Datas/ciclo são derivados pelo adapter concreto.
 */
export type ParamsAssinatura = {
  value: number;
  plano: PlanoParaProvider;
  loja: LojaParaProvider;
};

export interface BillingProvider {
  validarWebhook(headers: Headers, rawBody: string): boolean;
  extrairEventoId(payload: unknown): string | null;
  /**
   * Id da assinatura do provider (RN-9) — o webhook (077) resolve a loja por ele.
   * Ausente/inválido → `null` (cai no fallback por e-mail, se houver). Fecha o
   * `DadosEventoBilling.providerSubscriptionId`, antes órfão.
   */
  extrairSubscriptionId(payload: unknown): string | null;
  mapearEvento(payload: unknown): EventoBilling | null;
  extrairDados(payload: unknown): DadosPagamentoBilling;

  // ── Operações de INTENÇÃO do lojista (issue 078) ──────────────────────────
  /** Cria a assinatura no provider e devolve só o id agnóstico. */
  criarAssinatura(params: ParamsAssinatura): Promise<{ subscriptionId: string }>;
  /** Troca o plano de uma assinatura existente (keyed pelo subscriptionId). */
  atualizarAssinatura(
    params: ParamsAssinatura & { subscriptionId: string },
  ): Promise<{ subscriptionId: string }>;
  /** Solicita o cancelamento ao provider — NÃO otimista (status só pelo webhook). */
  cancelarAssinatura(subscriptionId: string): Promise<{ ok: true }>;
  /** URL do checkout hospedado para atualizar o meio de pagamento (RN-11). */
  urlMeioPagamento(subscriptionId: string): Promise<{ url: string }>;
}
