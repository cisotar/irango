import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import type { StatusAssinatura } from "@/lib/utils/assinatura";

/**
 * Queries do webhook de billing próprio (issue 077). Escrevem em tabelas que a RLS
 * proíbe para qualquer role exceto service_role (`webhook_eventos_billing` é
 * deny-all; `pagamentos_assinatura` só o dono LÊ; `lojas.assinatura_*`/`billing_*`
 * nem o dono escreve — trigger `lojas_protege_billing`). EXIGEM client
 * **service_role**; cada query escopa manualmente — a RLS não protege aqui.
 *
 * Padrão "Client injetado" (espelha `webhookHotmart.ts`): recebem o client por
 * parâmetro, não criam client nem leem env. Propagam o `error` do PostgREST
 * (seguranca.md §14) — em especial o 23505 do INSERT idempotente, que o handler
 * usa para detectar replay.
 */
type Client = SupabaseClient<Database>;

export type EventoBillingRegistro = {
  provider: string;
  evento_id: string;
  tipo: string;
  payload: Database["public"]["Tables"]["webhook_eventos_billing"]["Insert"]["payload"];
};

/**
 * INSERT idempotente do evento — TRAVA de idempotência. É o PRIMEIRO efeito: se o
 * par `(provider, evento_id)` já existe, bate na `UNIQUE(provider, evento_id)` e o
 * PostgREST devolve `error.code === "23505"`. Esse erro é PROPAGADO (throw) para o
 * handler decidir: 23505 → replay → 200 no-op sem reaplicar efeito. Qualquer outro
 * erro → 500.
 */
export async function registrarEventoBilling(
  client: Client,
  evento: EventoBillingRegistro,
): Promise<void> {
  const { error } = await client.from("webhook_eventos_billing").insert({
    provider: evento.provider,
    evento_id: evento.evento_id,
    tipo: evento.tipo,
    payload: evento.payload,
  });
  if (error) throw error;
}

/**
 * Resolve a loja pela assinatura do provider (RN-9). Via RPC SECURITY DEFINER
 * `loja_por_subscription_id`, que filtra `billing_provider = p_provider AND
 * provider_subscription_id = p_subscription_id` NO BANCO — uma loja de outro
 * provider nunca retorna. Sem casar → `null` (handler responde 200 sem efeito).
 * Escopo manual / service_role (a função é grant-só-service_role).
 */
export async function buscarLojaPorSubscriptionId(
  client: Client,
  provider: string,
  subscriptionId: string,
): Promise<LojaCompleta | null> {
  const { data, error } = await client
    .rpc("loja_por_subscription_id", {
      p_provider: provider,
      p_subscription_id: subscriptionId,
    })
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type DadosStatusBilling = {
  status: StatusAssinatura;
  /** Novo fim do ciclo pago. Só estende/define quando o evento renova. */
  fim_periodo?: Date | null;
  /** Primeira ativação: marca `assinatura_inicio`. Recorrência NÃO sobrescreve. */
  inicio?: Date | null;
};

/**
 * Aplica o estado autoritativo de assinatura na loja mapeada. Escopo manual por
 * `id` (service_role bypassa RLS e passa pelo trigger `lojas_protege_billing` —
 * este é o ÚNICO caminho legítimo de escrita de `assinatura_*`). `assinatura_
 * atualizada_em = now()` sempre. Campos opcionais ausentes não são tocados
 * (recorrência não zera `inicio`).
 */
export async function aplicarStatusBilling(
  client: Client,
  lojaId: string,
  dados: DadosStatusBilling,
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

  const { error } = await client.from("lojas").update(patch).eq("id", lojaId);
  if (error) throw error;
}

export type PagamentoRegistro = {
  loja_id: string;
  provider: string;
  provider_payment_id: string | null;
  valor: number;
  status: Database["public"]["Tables"]["pagamentos_assinatura"]["Insert"]["status"];
  metodo: string | null;
  fatura_url: string | null;
  competencia: Date | null;
};

/**
 * INSERT idempotente da fatura em `pagamentos_assinatura`. `valor` é AUTORITATIVO
 * do provider (§10/RN-1) — nunca do cliente. `onConflict(provider,
 * provider_payment_id)` com `ignoreDuplicates`: replay/entrega dupla do webhook
 * não duplica fatura (segunda barreira de idempotência, além do evento).
 */
export async function registrarPagamento(
  client: Client,
  pagamento: PagamentoRegistro,
): Promise<void> {
  const { error } = await client
    .from("pagamentos_assinatura")
    .upsert(
      {
        loja_id: pagamento.loja_id,
        provider: pagamento.provider,
        provider_payment_id: pagamento.provider_payment_id,
        valor: pagamento.valor,
        status: pagamento.status,
        metodo: pagamento.metodo,
        fatura_url: pagamento.fatura_url,
        competencia: pagamento.competencia ? pagamento.competencia.toISOString() : null,
      },
      { onConflict: "provider,provider_payment_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}
