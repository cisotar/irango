import { createServiceClient } from "@/lib/supabase/service";
import { getBillingProvider } from "@/lib/billing/providers";
import {
  registrarEventoBilling,
  buscarLojaPorSubscriptionId,
  aplicarStatusBilling,
  registrarPagamento,
} from "@/lib/supabase/queries/webhookBilling";
import {
  eventoBillingParaStatus,
  type EventoBilling,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";
import { calcularFimPeriodoBilling } from "@/lib/billing/providers/asaas";

// Adapters de billing usam `node:crypto` (validação tempo-constante) — runtime
// Node (não Edge). `force-dynamic` impede cache de POST com efeito.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function ok(): Response {
  return Response.json({ ok: true }, { status: 200 });
}

// EventoBilling lógico → status da fatura em pagamentos_assinatura (§10: derivado
// no servidor, nunca do cliente). Reembolso/chargeback → estornado; falha →
// falhou; demais (cobrança/recorrência aprovada) → pago.
function statusPagamento(evento: EventoBilling): "pago" | "falhou" | "estornado" {
  switch (evento) {
    case "reembolso":
    case "chargeback":
      return "estornado";
    case "pagamento_falhou":
      return "falhou";
    case "cobranca_aprovada":
    case "recorrencia_aprovada":
    case "assinatura_cancelada":
      return "pago";
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  // (0) rawBody ANTES do parse — providers HMAC futuros assinam o corpo cru
  // (re-serializar após parse muda bytes e invalida a assinatura). Corpo inválido
  // não é re-tentável: 400, não 500.
  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ erro: "payload invalido" }, { status: 400 });
  }

  // (1) PROVIDER da URL é input não-confiável. `getBillingProvider` é fail-closed
  // (lança p/ nome desconhecido) → 404 (recurso inexistente), sem efeito.
  const { provider } = await ctx.params;
  let adapter;
  try {
    adapter = getBillingProvider(provider);
  } catch {
    return Response.json({ erro: "provider desconhecido" }, { status: 404 });
  }

  // (2) AUTENTICIDADE — zero efeito antes de validar o segredo do webhook.
  if (!adapter.validarWebhook(request.headers, rawBody)) {
    return Response.json({ erro: "nao autorizado" }, { status: 401 });
  }

  // (3) IDEMPOTÊNCIA — sem evento_id não há trava: recusar (400).
  const eventoId = adapter.extrairEventoId(payload);
  if (!eventoId) {
    return Response.json({ erro: "evento sem identificador" }, { status: 400 });
  }

  const eventoTipo = obj(payload)?.event;
  const tipoTexto = typeof eventoTipo === "string" ? eventoTipo : "";

  try {
    const svc = createServiceClient();

    // (4) TRAVA atômica: INSERT do evento PRIMEIRO. 23505 = replay → 200 no-op,
    // NÃO aplica efeito (replay nunca reativa nem duplica fatura).
    try {
      await registrarEventoBilling(svc, {
        provider,
        evento_id: eventoId,
        tipo: tipoTexto,
        payload: payload as never,
      });
    } catch (e) {
      if (obj(e)?.code === "23505") return ok();
      throw e;
    }

    // (5) RESOLVER loja por subscription_id (RN-9 no banco). Sem sub_id ou sem
    // loja → 200 sem UPDATE (evento fica registrado p/ auditoria/reconciliação).
    const subscriptionId = adapter.extrairSubscriptionId(payload);
    const loja = subscriptionId
      ? await buscarLojaPorSubscriptionId(svc, provider, subscriptionId)
      : null;
    if (!loja) return ok();

    // (6) RN-9 (defesa-em-profundidade): só toca loja do PRÓPRIO provider.
    if (loja.billing_provider !== provider) return ok();

    // (7) TRADUZIR evento externo→lógico. Desconhecido → 200 sem mudar `lojas`.
    const eventoLogico = adapter.mapearEvento(payload);
    if (!eventoLogico) return ok();

    // (8) lógico→status. `{ignorar}` → 200 sem efeito.
    const resultado = eventoBillingParaStatus(provider, eventoLogico);
    if ("ignorar" in resultado) return ok();

    // (9) RN-10: loja `cancelada` NÃO reativa por renovação espúria. Só bloqueia
    // eventos que LEVARIAM a status de acesso (ativa/cortesia).
    const statusAtual = loja.assinatura_status as StatusAssinatura;
    const reativaria = resultado.status === "ativa" || resultado.status === "cortesia";
    if (statusAtual === "cancelada" && reativaria) return ok();

    // (10) APLICAR efeito. `fim_periodo` só estende/define quando renova; `inicio`
    // só na primeira ativação (estava sem início) — recorrência não o toca.
    const agora = new Date();
    const dados: Parameters<typeof aplicarStatusBilling>[2] = { status: resultado.status };
    if (resultado.renova) {
      dados.fim_periodo = calcularFimPeriodoBilling(undefined, agora);
      if (!loja.assinatura_inicio) dados.inicio = agora;
    }
    await aplicarStatusBilling(svc, loja.id, dados);

    // Fatura — `valor` AUTORITATIVO do payload do provider (§10/RN-1).
    const pagamento = adapter.extrairDados(payload);
    await registrarPagamento(svc, {
      loja_id: loja.id,
      provider,
      provider_payment_id: pagamento.provider_payment_id,
      valor: pagamento.valor,
      status: statusPagamento(eventoLogico),
      metodo: pagamento.metodo,
      fatura_url: pagamento.fatura_url,
      competencia: pagamento.competencia,
    });

    return ok();
  } catch (e) {
    // seguranca.md §14 — detalhe só no servidor; corpo genérico. O provider
    // re-tenta; a idempotência cobre o reprocesso.
    console.error("[webhook-billing]", e);
    return Response.json({ erro: "erro interno" }, { status: 500 });
  }
}
