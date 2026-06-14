import { createServiceClient } from "@/lib/supabase/service";
import {
  registrarEventoWebhook,
  vincularLojaAoEvento,
  aplicarStatusAssinatura,
} from "@/lib/supabase/queries/webhookHotmart";
import { buscarLojaPorEmailDono } from "@/lib/supabase/queries/lojas";
import { eventoParaStatus, type StatusAssinatura } from "@/lib/utils/assinatura";
import {
  validarHottok,
  extrairEventoId,
  mapearEventoHotmart,
  calcularFimPeriodo,
} from "@/lib/utils/hotmart";

// `crypto.timingSafeEqual` exige runtime Node (não Edge); `force-dynamic` impede
// cache de uma rota POST com efeito (D6).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

// Extratores do contrato externo. // TODO: confirmar doc Hotmart (caminhos).
function extrairHottok(headers: Headers, payload: unknown): string | null {
  const doHeader = headers.get("x-hotmart-hottok");
  if (doHeader) return doHeader;
  const p = obj(payload);
  return p && typeof p.hottok === "string" ? p.hottok : null;
}

function extrairEmailComprador(payload: unknown): string | null {
  const p = obj(payload);
  const data = p ? obj(p.data) : null;
  const buyer = data ? obj(data.buyer) : null;
  const email = buyer && typeof buyer.email === "string" ? buyer.email : null;
  return email ? email.trim().toLowerCase() : null;
}

function extrairDadosAssinatura(payload: unknown): {
  subscriber_code: string | null;
  plano: string | null;
  proximaCobranca: unknown;
} {
  const p = obj(payload);
  const data = p ? obj(p.data) : null;
  const subscription = data ? obj(data.subscription) : null;
  const plan = subscription ? obj(subscription.plan) : null;
  const purchase = data ? obj(data.purchase) : null;
  return {
    subscriber_code:
      subscription && typeof subscription.subscriber_code === "string"
        ? subscription.subscriber_code
        : null,
    plano: plan && typeof plan.name === "string" ? plan.name : null,
    proximaCobranca: purchase ? purchase.date_next_charge : undefined,
  };
}

function ok(): Response {
  return Response.json({ ok: true }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  // (0) parse — corpo inválido não é re-tentável: 400, não 500.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ erro: "payload invalido" }, { status: 400 });
  }

  // (1) AUTENTICIDADE (RN-A2) — zero efeito antes de validar o segredo.
  const hottok = extrairHottok(request.headers, payload);
  if (!validarHottok(hottok, process.env.HOTMART_WEBHOOK_TOKEN)) {
    return Response.json({ erro: "nao autorizado" }, { status: 401 });
  }

  // (2) IDEMPOTÊNCIA — sem evento_id não há trava: recusar (400).
  const eventoId = extrairEventoId(payload);
  if (!eventoId) {
    return Response.json({ erro: "evento sem identificador" }, { status: 400 });
  }

  const eventoTipo =
    obj(payload) && typeof obj(payload)!.event === "string"
      ? (obj(payload)!.event as string)
      : null;
  const emailComprador = extrairEmailComprador(payload);

  try {
    const svc = createServiceClient();

    // (3) TRAVA atômica: INSERT do evento PRIMEIRO. 23505 = replay → 200 no-op,
    // NÃO aplica efeito (replay nunca reativa assinatura suspensa — RN-A3).
    try {
      await registrarEventoWebhook(svc, {
        evento_id: eventoId,
        evento_tipo: eventoTipo,
        email_comprador: emailComprador,
        payload: payload as never,
      });
    } catch (e) {
      if (obj(e)?.code === "23505") return ok();
      throw e;
    }

    // (4) MAPEAR comprador→loja. Sem e-mail ou sem loja → 200 sem UPDATE
    // (reconciliação fica p/ issue 059).
    const loja = emailComprador ? await buscarLojaPorEmailDono(svc, emailComprador) : null;
    if (!loja) return ok();

    // (5) TRADUZIR evento externo→lógico→status. Desconhecido / ignorar → 200
    // sem mudar `lojas`.
    const eventoLogico = eventoTipo ? mapearEventoHotmart(eventoTipo) : null;
    if (!eventoLogico) return ok();

    const statusAtual = loja.assinatura_status as StatusAssinatura;
    const resultado = eventoParaStatus(eventoLogico, statusAtual);
    if ("ignorar" in resultado) return ok();

    // (6) APLICAR efeito. `fim_periodo` só estende/define quando renova; `inicio`
    // só na primeira ativação (estava trial/sem início) — recorrência não o toca.
    const { subscriber_code, plano, proximaCobranca } = extrairDadosAssinatura(payload);
    const agora = new Date();
    const dados: Parameters<typeof aplicarStatusAssinatura>[2] = {
      status: resultado.status,
      subscriber_code,
      plano,
    };
    if (resultado.renova) {
      dados.fim_periodo = calcularFimPeriodo(proximaCobranca, agora);
      if (!loja.assinatura_inicio) dados.inicio = agora;
    }

    await aplicarStatusAssinatura(svc, loja.id, dados);
    await vincularLojaAoEvento(svc, eventoId, loja.id);

    return ok();
  } catch (e) {
    // seguranca.md §14 — detalhe só no servidor; corpo genérico. Hotmart re-tenta;
    // a idempotência cobre o reprocesso.
    console.error("[webhook-hotmart]", e);
    return Response.json({ erro: "erro interno" }, { status: 500 });
  }
}
