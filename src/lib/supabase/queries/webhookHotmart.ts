import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { StatusAssinatura } from "@/lib/utils/assinatura";

/**
 * Queries do webhook Hotmart (issue 057). Escrevem em tabelas que a RLS proíbe
 * para qualquer role exceto service_role (`webhook_eventos_hotmart` é deny-all;
 * `lojas.assinatura_*` nem o dono escreve). EXIGEM client **service_role**, e por
 * isso TODA query escopa manualmente — a RLS não protege aqui.
 *
 * Padrão "Client injetado": recebem o client por parâmetro, não criam client nem
 * leem env. Propagam o `error` do PostgREST (seguranca.md §14) — em especial o
 * 23505 do INSERT idempotente, que o handler usa para detectar replay.
 */
type Client = SupabaseClient<Database>;

export type EventoWebhook = {
  evento_id: string;
  evento_tipo: string | null;
  email_comprador: string | null;
  payload: Database["public"]["Tables"]["webhook_eventos_hotmart"]["Insert"]["payload"];
};

/**
 * INSERT idempotente do evento — TRAVA de idempotência (D4). É o PRIMEIRO efeito:
 * se o `evento_id` já existe, bate na `UNIQUE(evento_id)` e o PostgREST devolve
 * `error.code === "23505"`. Esse erro é PROPAGADO (throw) para o handler decidir:
 * 23505 → replay → 200 no-op sem reaplicar efeito. Qualquer outro erro → 500.
 */
export async function registrarEventoWebhook(
  client: Client,
  evento: EventoWebhook,
): Promise<void> {
  const { error } = await client.from("webhook_eventos_hotmart").insert({
    evento_id: evento.evento_id,
    evento_tipo: evento.evento_tipo,
    email_comprador: evento.email_comprador,
    payload: evento.payload,
  });
  if (error) throw error;
}

/**
 * Vincula a loja mapeada ao evento já registrado (auditoria). Escopo manual por
 * `evento_id` (service_role bypassa RLS).
 */
export async function vincularLojaAoEvento(
  client: Client,
  eventoId: string,
  lojaId: string,
): Promise<void> {
  const { error } = await client
    .from("webhook_eventos_hotmart")
    .update({ loja_id: lojaId })
    .eq("evento_id", eventoId);
  if (error) throw error;
}

export type EventoOrfao = {
  evento_id: string;
  /** Nome EXTERNO Hotmart (ex.: PURCHASE_APPROVED). */
  evento_tipo: string | null;
  /** Payload bruto — derivar subscriber_code/plano/proximaCobranca. */
  payload: Database["public"]["Tables"]["webhook_eventos_hotmart"]["Row"]["payload"];
  /** Ordenação cronológica do fold. */
  processado_em: string;
};

/**
 * Eventos AINDA não reconciliados (`loja_id IS NULL`) cujo comprador casa EXATO
 * com o email normalizado. Match exato (`eq`) sobre o email em lower(trim) — o
 * webhook (057, route.ts) já grava `email_comprador` em lower(trim). NUNCA `ilike`:
 * o LIKE trata `_` e `%` do email do atacante como wildcard (ex.: `vic_im@x` casa
 * `victim@x`) → roubo de assinatura órfã alheia (auditoria 059, FIX 1 CRÍTICA).
 * Ordem cronológica (`processado_em ASC`) para o fold consolidar o estado final.
 * Escopo manual: `webhook_eventos_hotmart` é deny-all/PII — exige service_role
 * (BYPASSRLS). Propaga error (seguranca.md §14).
 */
export async function buscarEventosOrfaosPorEmail(
  client: Client,
  email: string,
): Promise<EventoOrfao[]> {
  const alvo = email.trim().toLowerCase();
  const { data, error } = await client
    .from("webhook_eventos_hotmart")
    .select("evento_id, evento_tipo, payload, processado_em")
    .is("loja_id", null)
    .eq("email_comprador", alvo)
    .order("processado_em", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventoOrfao[];
}

export type DadosAssinatura = {
  status: StatusAssinatura;
  /** Novo fim do ciclo pago. Só estende/define quando o evento renova. */
  fim_periodo?: Date | null;
  /** Primeira ativação: marca `assinatura_inicio`. Recorrência NÃO sobrescreve. */
  inicio?: Date | null;
  subscriber_code?: string | null;
  plano?: string | null;
};

/**
 * Aplica o estado autoritativo de assinatura na loja mapeada (RN-A4). Escopo
 * manual por `id` (service_role bypassa RLS — este é o ÚNICO caminho legítimo de
 * escrita de `assinatura_*`, RN-A5). `assinatura_atualizada_em = now()` sempre.
 * Campos opcionais ausentes não são tocados (recorrência não zera `inicio`).
 */
export async function aplicarStatusAssinatura(
  client: Client,
  lojaId: string,
  dados: DadosAssinatura,
): Promise<void> {
  const patch: Database["public"]["Tables"]["lojas"]["Update"] = {
    assinatura_status: dados.status,
    assinatura_atualizada_em: new Date().toISOString(),
  };
  if (dados.fim_periodo !== undefined) {
    patch.assinatura_fim_periodo = dados.fim_periodo ? dados.fim_periodo.toISOString() : null;
  }
  if (dados.inicio !== undefined) {
    patch.assinatura_inicio = dados.inicio ? dados.inicio.toISOString() : null;
  }
  if (dados.subscriber_code !== undefined) {
    patch.hotmart_subscriber_code = dados.subscriber_code;
  }
  if (dados.plano !== undefined) {
    patch.hotmart_plano = dados.plano;
  }

  const { error } = await client.from("lojas").update(patch).eq("id", lojaId);
  if (error) throw error;
}
