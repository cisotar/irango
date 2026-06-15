import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  type StatusAssinatura,
  eventoParaStatus,
} from "@/lib/utils/assinatura";
import { calcularFimPeriodo, mapearEventoHotmart } from "@/lib/utils/hotmart";
import {
  type EventoOrfao,
  aplicarStatusAssinatura,
  buscarEventosOrfaosPorEmail,
  vincularLojaAoEvento,
} from "@/lib/supabase/queries/webhookHotmart";

/**
 * Reconciliação de comprador sem conta (issue 059). Quando alguém paga a
 * assinatura na Hotmart ANTES de criar conta, o webhook (057) gravou o evento
 * com `loja_id NULL` (órfão). No cadastro (015), esta função vincula esses
 * eventos à loja recém-criada — por email do usuário AUTENTICADO, nunca de input
 * forjável (RN-A1) — e aplica o estado de assinatura resultante.
 *
 * Server-only: lê `webhook_eventos_hotmart` (deny-all/PII) e escreve `assinatura_*`
 * — só via service_role (BYPASSRLS), injetado pelo caller (padrão queries/). O
 * trigger `lojas_protege_billing` autoriza a escrita de billing por service_role.
 *
 * Idempotente: a 2ª chamada acha 0 órfãos (todos já têm `loja_id`) → no-op.
 */
function lerObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Data de próxima cobrança do payload bruto (mesmo caminho do webhook 057). */
function extrairProximaCobranca(payload: EventoOrfao["payload"]): unknown {
  const p = lerObjeto(payload);
  const data = p ? lerObjeto(p.data) : null;
  const purchase = data ? lerObjeto(data.purchase) : null;
  return purchase ? purchase.date_next_charge : undefined;
}

/** subscriber_code do payload bruto (mesmo caminho do webhook 057). */
function extrairSubscriberCode(payload: EventoOrfao["payload"]): string | null {
  const p = lerObjeto(payload);
  const data = p ? lerObjeto(p.data) : null;
  const subscription = data ? lerObjeto(data.subscription) : null;
  return subscription && typeof subscription.subscriber_code === "string"
    ? subscription.subscriber_code
    : null;
}

export async function reconciliarAssinatura(
  svc: SupabaseClient<Database>,
  email: string,
  lojaId: string,
): Promise<void> {
  const orfaos = await buscarEventosOrfaosPorEmail(svc, email);
  if (orfaos.length === 0) return; // nada a reconciliar — loja segue trial.

  // FAIL-CLOSED (auditoria 059, FIX 3 MÉDIA): o fold consolida UM estado por email,
  // sem particionar por assinatura. Se os órfãos carregam ≥2 subscriber_code
  // distintos, são assinaturas diferentes do mesmo email → consolidar daria estado
  // ambíguo (uma cobre a outra). Não aplica nada (loja segue trial), reporta e sai.
  const codigos = new Set(
    orfaos.map((e) => extrairSubscriberCode(e.payload)).filter((c): c is string => c !== null),
  );
  if (codigos.size >= 2) {
    console.error(
      "[reconciliarAssinatura] órfãos com subscriber_code ambíguos — não aplica estado",
      { lojaId, email, subscriberCodes: [...codigos] },
    );
    return;
  }

  const agora = new Date();
  // FOLD cronológico (já vem ASC): consolida o ESTADO FINAL da sequência real.
  // compra→ativa; compra+cancelamento→cancelada; reembolso→suspensa.
  let status: StatusAssinatura | null = null;
  let fimPeriodo: Date | null = null;
  let subscriberCode: string | null = null;

  for (const evento of orfaos) {
    if (!evento.evento_tipo) continue; // sem tipo → ignora (auditoria via vínculo).
    const logico = mapearEventoHotmart(evento.evento_tipo);
    if (!logico) continue; // evento desconhecido → não muda estado.
    const resultado = eventoParaStatus(logico, status ?? "trial");
    if ("ignorar" in resultado) continue;

    status = resultado.status;
    if (resultado.renova) {
      fimPeriodo = calcularFimPeriodo(extrairProximaCobranca(evento.payload), agora);
    }
    const sc = extrairSubscriberCode(evento.payload);
    if (sc) subscriberCode = sc; // mais recente vence.
  }

  // UMA escrita do estado consolidado (idempotente; sem escritas intermediárias).
  if (status !== null) {
    await aplicarStatusAssinatura(svc, lojaId, {
      status,
      fim_periodo: fimPeriodo ?? undefined,
      subscriber_code: subscriberCode ?? undefined,
    });
  }

  // Marca TODOS os órfãos como reconciliados (loja_id setado) → fecha o ciclo e
  // garante que a próxima chamada não os reprocesse.
  for (const evento of orfaos) {
    await vincularLojaAoEvento(svc, evento.evento_id, lojaId);
  }
}
