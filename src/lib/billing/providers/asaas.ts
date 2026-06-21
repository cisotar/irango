import "server-only";
import { timingSafeEqual } from "node:crypto";
import { type EventoBilling } from "@/lib/utils/assinatura";
import type { BillingProvider, ParamsAssinatura } from "../tipos";

/**
 * Módulo de ADAPTAÇÃO do contrato externo Asaas (issue 076). Funções PURAS,
 * sem I/O — toda a especificidade do provider (nomes de evento crus, formato do
 * payload, validação do token estático do webhook) fica isolada aqui. Trocar o
 * provider muda só este arquivo, nunca o webhook (077) nem as Server Actions
 * (078), que permanecem agnósticos. Espelha o padrão de `src/lib/utils/hotmart.ts`.
 *
 * server-only: o adapter inteiro vive no servidor; qualquer import acidental de
 * Client Component quebra o build.
 */

function asObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

// Mapa nome externo Asaas → EventoBilling lógico (provider-agnóstico, union de
// assinatura.ts — 075). NÃO redefinir o tipo aqui. Só os eventos que ALTERAM
// `assinatura_status`; eventos de ciclo intermediário caem em `null` (o 077 loga
// p/ auditoria e responde 2xx, sem mudar estado). Fonte: docs.asaas.com/docs/payment-events.
const MAPA_EVENTOS_ASAAS: Record<string, EventoBilling> = {
  PAYMENT_CONFIRMED: "cobranca_aprovada",
  PAYMENT_RECEIVED: "recorrencia_aprovada",
  PAYMENT_OVERDUE: "pagamento_falhou",
  PAYMENT_DELETED: "assinatura_cancelada",
  PAYMENT_REFUNDED: "reembolso",
  PAYMENT_PARTIALLY_REFUNDED: "reembolso",
  PAYMENT_CHARGEBACK_REQUESTED: "chargeback",
};

/**
 * Traduz o nome externo do evento Asaas para o `EventoBilling` lógico. Evento
 * desconhecido / intermediário / "" → `null` (o 077 loga p/ auditoria e responde
 * 2xx, NÃO muda o estado da assinatura).
 */
export function mapearEventoAsaas(tipoExterno: string): EventoBilling | null {
  return MAPA_EVENTOS_ASAAS[tipoExterno] ?? null;
}

/**
 * Comparação tempo-constante do token estático do webhook Asaas (header
 * `asaas-access-token`) contra o segredo configurado (D3, RN, §9). NUNCA usa
 * `===` (vaza timing). NUNCA lança — comprimentos diferentes retornam `false`
 * (timingSafeEqual exige buffers de igual tamanho). Sem token (null) ou sem
 * segredo (vazio) → `false` (nunca autoriza às cegas).
 */
export function validarTokenAsaas(token: string | null, segredo: string): boolean {
  if (!token || !segredo) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(segredo, "utf8");
  // Guarda de comprimento: timingSafeEqual lança se os tamanhos diferem.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Fim do período de assinatura. PURA: `agora` injetado (nunca Date.now). Usa a
 * data de próxima cobrança do Asaas se presente, parseável E no futuro; senão
 * fallback `agora + 30 dias` — nunca grava Invalid Date nem data no passado.
 */
export function calcularFimPeriodoBilling(proximaCobranca: unknown, agora: Date): Date {
  if (proximaCobranca !== undefined && proximaCobranca !== null) {
    const candidato = new Date(proximaCobranca as string);
    if (!Number.isNaN(candidato.getTime()) && candidato.getTime() > agora.getTime()) {
      return candidato;
    }
  }
  return new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Shape do pagamento que o 077 grava em `pagamentos_assinatura`. `valor` vem
 * EXCLUSIVAMENTE de `payment.value` do provider (autoritativo, §10/RN-1) — o
 * adapter nunca inventa valor nem confia no cliente.
 */
export type DadosPagamentoBilling = {
  provider_payment_id: string | null;
  valor: number;
  metodo: string | null;
  fatura_url: string | null;
  competencia: Date | null;
};

const MAPA_METODO_ASAAS: Record<string, string> = {
  PIX: "pix",
  BOLETO: "boleto",
  CREDIT_CARD: "cartao",
};

/**
 * Extrai do payload cru Asaas o objeto de pagamento. Campos ausentes/inválidos
 * → `null` (o adapter não inventa valor). `payment.value` é a autoridade do
 * dinheiro.
 */
export function extrairDadosAsaas(payload: unknown): DadosPagamentoBilling {
  const p = asObjeto(payload);
  const payment = p ? asObjeto(p.payment) : null;

  const provider_payment_id =
    payment && typeof payment.id === "string" && payment.id.length > 0 ? payment.id : null;

  const valor =
    payment && typeof payment.value === "number" && !Number.isNaN(payment.value)
      ? payment.value
      : 0;

  const metodo =
    payment && typeof payment.billingType === "string"
      ? (MAPA_METODO_ASAAS[payment.billingType] ?? null)
      : null;

  const fatura_url =
    payment && typeof payment.invoiceUrl === "string" && payment.invoiceUrl.length > 0
      ? payment.invoiceUrl
      : null;

  const dataCompetencia =
    payment && (typeof payment.paymentDate === "string" || typeof payment.dueDate === "string")
      ? (payment.paymentDate ?? payment.dueDate)
      : null;
  let competencia: Date | null = null;
  if (typeof dataCompetencia === "string") {
    const d = new Date(dataCompetencia);
    if (!Number.isNaN(d.getTime())) competencia = d;
  }

  return { provider_payment_id, valor, metodo, fatura_url, competencia };
}

/**
 * Id canônico do evento p/ idempotência (077 INSERT ON CONFLICT). Top-level
 * `payload.id` do envelope Asaas; ausente → `null` (sem id não há trava de
 * idempotência → 077 responde 400).
 */
export function extrairEventoIdAsaas(payload: unknown): string | null {
  const p = asObjeto(payload);
  if (!p) return null;
  return typeof p.id === "string" && p.id.length > 0 ? p.id : null;
}

/**
 * Id da assinatura Asaas para o lookup da loja (RN-9, 077). Lê `payment.subscription`
 * do payload — string ou `null` (cobrança avulsa sem assinatura, ou payload sem o
 * campo). Pura, defensiva. Fecha o `DadosEventoBilling.providerSubscriptionId`.
 */
export function extrairSubscriptionIdAsaas(payload: unknown): string | null {
  const p = asObjeto(payload);
  const payment = p ? asObjeto(p.payment) : null;
  return payment && typeof payment.subscription === "string" ? payment.subscription : null;
}

/**
 * Lê o nome externo cru do evento (`payload.event`) — string vazia se ausente,
 * que o mapa traduz para `null`. Pura, defensiva.
 */
function extrairTipoEventoAsaas(payload: unknown): string {
  const p = asObjeto(payload);
  return p && typeof p.event === "string" ? p.event : "";
}

// ── Cliente HTTP da API Asaas v3 (issue 078) ────────────────────────────────
// I/O REAL: estas funções batem na rede Asaas. Server-only (o adapter inteiro
// importa "server-only"). Nos testes RED/GREEN das Server Actions o provider é
// MOCKADO via getBillingProvider — este código não é exercido offline.

/** Base da API Asaas (sandbox vs prod via env). Default = sandbox. */
function baseUrlAsaas(): string {
  return process.env.ASAAS_API_BASE_URL ?? "https://sandbox.asaas.com/api/v3";
}

/** Header de autenticação Asaas. `ASAAS_API_KEY` é server-only (§7/§9). */
function headersAsaas(): HeadersInit {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error("ASAAS_API_KEY não configurada");
  return {
    "Content-Type": "application/json",
    access_token: apiKey,
  };
}

/**
 * Helper de chamada à API Asaas. Lança em status != 2xx — o `e.message` fica no
 * servidor (a Server Action faz `console.error` e devolve mensagem genérica, §14).
 */
async function chamarAsaas(
  caminho: string,
  init: { method: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${baseUrlAsaas()}${caminho}`, {
    method: init.method,
    headers: headersAsaas(),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const texto = await resp.text();
  const json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  if (!resp.ok) {
    throw new Error(`Asaas ${resp.status} em ${caminho}: ${texto}`);
  }
  return json;
}

/** `nextDueDate` (YYYY-MM-DD) = hoje (primeira cobrança imediata). */
function proximaDataVencimento(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

/** Mapeia o `intervalo` lógico do plano para o `cycle` do Asaas. */
function cicloAsaas(intervalo: string): string {
  return intervalo === "anual" ? "YEARLY" : "MONTHLY";
}

/**
 * Cria um CLIENTE no Asaas (`POST /v3/customers`). D1-b: o customer é criado
 * INLINE e DESCARTADO — não se persiste `asaas_customer_id` na v1. O guard de
 * double-init na Server Action impede customer duplicado (a doc Asaas afirma que
 * `POST /v3/customers` NÃO é idempotente). `externalReference = loja.id` dá
 * rastreabilidade no painel Asaas.
 * TODO(v2): se o reuso de customer virar necessário (trial→pago sem recriar),
 * persistir o id numa coluna própria com migration dedicada.
 */
export async function criarClienteAsaas(dados: {
  nome: string;
  email: string;
  externalReference: string;
}): Promise<{ id: string }> {
  const json = await chamarAsaas("/customers", {
    method: "POST",
    body: {
      name: dados.nome,
      email: dados.email,
      externalReference: dados.externalReference,
    },
  });
  const id = typeof json.id === "string" ? json.id : null;
  if (!id) throw new Error("Asaas: customer sem id na resposta");
  return { id };
}

/**
 * Cria a assinatura no Asaas (`POST /v3/subscriptions`). Cria o customer
 * internamente (D1-b) e usa `value = planos.preco` AUTORITATIVO do banco (RN-1).
 * Devolve só o id agnóstico (`{ subscriptionId }`).
 */
export async function criarAssinaturaAsaas(
  params: ParamsAssinatura,
): Promise<{ subscriptionId: string }> {
  const cliente = await criarClienteAsaas({
    nome: params.loja.nome,
    email: params.loja.email,
    externalReference: params.loja.id,
  });
  const json = await chamarAsaas("/subscriptions", {
    method: "POST",
    body: {
      customer: cliente.id,
      billingType: "UNDEFINED", // cliente escolhe no checkout hospedado (RN-11)
      value: params.value,
      nextDueDate: proximaDataVencimento(new Date()),
      cycle: cicloAsaas(params.plano.intervalo),
      externalReference: params.loja.id,
    },
  });
  const subscriptionId = typeof json.id === "string" ? json.id : null;
  if (!subscriptionId) throw new Error("Asaas: subscription sem id na resposta");
  return { subscriptionId };
}

/**
 * Troca o plano/valor de uma assinatura existente (`POST /v3/subscriptions/{id}`).
 * Keyed pelo `subscriptionId` — não recria customer. `value` autoritativo do banco.
 */
export async function atualizarAssinaturaAsaas(
  params: ParamsAssinatura & { subscriptionId: string },
): Promise<{ subscriptionId: string }> {
  await chamarAsaas(`/subscriptions/${params.subscriptionId}`, {
    method: "POST",
    body: {
      value: params.value,
      cycle: cicloAsaas(params.plano.intervalo),
    },
  });
  return { subscriptionId: params.subscriptionId };
}

/**
 * Solicita o cancelamento da assinatura (`DELETE /v3/subscriptions/{id}`). NÃO
 * otimista: a Server Action NÃO escreve `assinatura_status` (RN-7) — o status
 * efetivo muda só quando o webhook (077) confirmar.
 */
export async function cancelarAssinaturaAsaas(
  subscriptionId: string,
): Promise<{ ok: true }> {
  await chamarAsaas(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
  return { ok: true };
}

/**
 * URL do checkout/fatura hospedado do Asaas para atualizar o meio de pagamento
 * (RN-11) — dados de cartão NUNCA tocam o iRango (PCI scope é do provider). Lê a
 * `paymentLink`/`invoiceUrl` da assinatura.
 */
export async function urlMeioPagamentoAsaas(
  subscriptionId: string,
): Promise<{ url: string }> {
  const json = await chamarAsaas(`/subscriptions/${subscriptionId}`, {
    method: "GET",
  });
  const url =
    (typeof json.paymentLink === "string" && json.paymentLink) ||
    (typeof json.invoiceUrl === "string" && json.invoiceUrl) ||
    null;
  if (!url) throw new Error("Asaas: assinatura sem URL de pagamento");
  return { url };
}

/**
 * Objeto concreto que implementa o contrato AGNÓSTICO `BillingProvider` (076).
 * Referencia as funções puras (webhook) e de I/O (intenção 078) acima —
 * `getBillingProvider("asaas")` o devolve; webhook (077) e Server Actions (078)
 * operam contra a interface sem conhecer o Asaas.
 */
export const asaasProvider: BillingProvider = {
  validarWebhook(headers, _rawBody) {
    const token = headers.get("asaas-access-token");
    const segredo = process.env.ASAAS_WEBHOOK_TOKEN ?? "";
    return validarTokenAsaas(token, segredo);
  },
  extrairEventoId: extrairEventoIdAsaas,
  extrairSubscriptionId: extrairSubscriptionIdAsaas,
  mapearEvento(payload) {
    return mapearEventoAsaas(extrairTipoEventoAsaas(payload));
  },
  extrairDados: extrairDadosAsaas,
  criarAssinatura: criarAssinaturaAsaas,
  atualizarAssinatura: atualizarAssinaturaAsaas,
  cancelarAssinatura: cancelarAssinaturaAsaas,
  urlMeioPagamento: urlMeioPagamentoAsaas,
};
