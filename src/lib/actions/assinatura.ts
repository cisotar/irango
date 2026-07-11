"use server";

// FRONTEIRA DE INTENÇÃO DO LOJISTA (issue 078). O lojista DISPARA intenções de
// billing — iniciar / trocar / atualizar pagamento / cancelar — mas NUNCA define
// valor nem status (seguranca.md §9, RN-1/RN-2):
//
//   - PREÇO: lido EXCLUSIVAMENTE de `planos.preco` no banco (RN-1). O cliente
//     manda só `plano_id`; `.strict()` rejeita qualquer `preco`/`value` injetado.
//   - STATUS: nenhuma destas actions escreve `assinatura_status` (RN-2/RN-7) — só
//     o webhook (077) é a autoridade. `cancelar` NÃO é otimista.
//   - ESCRITA das colunas billing-intent (`billing_provider`/`provider_subscription_id`/
//     `plano_id`): via SERVICE_ROLE, porque o trigger `lojas_protege_billing`
//     (migration 074) bloqueia o role autenticado. Escopo manual por `id`, com
//     `lojaId` DERIVADO da loja do `auth.uid()` (RLS), nunca do payload (D2).
//   - DADOS DE CARTÃO nunca trafegam: atualizar pagamento devolve só a URL do
//     checkout hospedado do provider (RN-11).
//
// Mandato `use-server-export-constraint`: este arquivo só pode exportar funções
// `async` — nenhuma `const`/`type` exportada (quebraria no `next build`).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaDoDono, persistirAssinaturaLoja } from "@/lib/supabase/queries/lojas";
import { buscarPlanoAtivo } from "@/lib/supabase/queries/planos";
import {
  providerBillingAtivo,
  nomeProviderBillingAtivo,
} from "@/lib/billing/providers";
import { iniciarAssinaturaSchema } from "@/lib/validacoes/assinatura";
import type { LojaParaProvider } from "@/lib/billing/tipos";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

type ResultadoAssinatura =
  | { ok: true }
  | { ok: true; url: string }
  | { ok: false; erro: string };

/**
 * Monta o `loja` AGNÓSTICO passado ao provider. `email` vem do usuário
 * AUTENTICADO (a tabela `lojas` não guarda email — vínculo dono↔email vive em
 * `auth.users`). Defensivo: cliente sem `.auth` (testes) → email vazio.
 */
async function lojaParaProvider(
  client: Awaited<ReturnType<typeof createClient>>,
  loja: LojaCompleta,
): Promise<LojaParaProvider> {
  let email = "";
  const auth = (client as { auth?: { getUser?: () => Promise<{ data: { user: { email?: string | null } | null } }> } }).auth;
  if (auth?.getUser) {
    const { data } = await auth.getUser();
    email = data.user?.email ?? "";
  }
  return { id: loja.id, nome: loja.nome, email };
}

/**
 * Inicia a assinatura: valida posse → guard double-init → lê preço do banco →
 * cria no provider (customer interno, D1-b) → persiste subId via service_role.
 */
export async function iniciarAssinatura(
  payload: unknown,
): Promise<ResultadoAssinatura> {
  // 1) `.strict()` rejeita valor/preço injetado ANTES de qualquer I/O (RN-1, §10).
  const parsed = iniciarAssinaturaSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Plano inválido." };
  }
  const { plano_id } = parsed.data;

  try {
    // 2) Posse: loja do `auth.uid()` (RLS). Não-dono / sem sessão → null.
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    // 3) GUARD double-init: já tem assinatura → não recria (evita customer
    //    duplicado no Asaas, fecha o contra de D1-b). SEM tocar o provider.
    if (loja.provider_subscription_id != null) {
      return { ok: false, erro: "Assinatura já iniciada." };
    }

    // 4) Preço AUTORITATIVO do banco (RN-1). Plano inativo/inexistente → barra.
    const svc = createServiceClient();
    const plano = await buscarPlanoAtivo(svc, plano_id);
    if (plano == null) {
      return { ok: false, erro: "Plano indisponível." };
    }

    // 5) Cria no provider com `value` = planos.preco (NUNCA do cliente).
    const { subscriptionId } = await providerBillingAtivo().criarAssinatura({
      value: plano.preco,
      plano,
      loja: await lojaParaProvider(supabase, loja),
    });

    // 6) Persiste billing-intent via service_role. NÃO inclui assinatura_status (RN-2).
    await persistirAssinaturaLoja(svc, loja.id, {
      billing_provider: nomeProviderBillingAtivo(),
      provider_subscription_id: subscriptionId,
      plano_id: plano.id,
    });

    return { ok: true };
  } catch (e) {
    // §14: erro interno NUNCA vaza ao cliente — log no servidor, msg genérica.
    console.error("[iniciarAssinatura]", e);
    return {
      ok: false,
      erro: "Não foi possível iniciar a assinatura. Tente novamente.",
    };
  }
}

/**
 * Troca o plano: EXIGE assinatura ativa. Atualiza no provider com o preço do
 * banco; status efetivo só muda quando o webhook confirmar (RN-6).
 */
export async function trocarPlano(
  payload: unknown,
): Promise<ResultadoAssinatura> {
  const parsed = iniciarAssinaturaSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Plano inválido." };
  }
  const { plano_id } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    if (loja.provider_subscription_id == null) {
      return { ok: false, erro: "Nenhuma assinatura ativa para trocar." };
    }

    const svc = createServiceClient();
    const plano = await buscarPlanoAtivo(svc, plano_id);
    if (plano == null) {
      return { ok: false, erro: "Plano indisponível." };
    }

    await providerBillingAtivo().atualizarAssinatura({
      subscriptionId: loja.provider_subscription_id,
      value: plano.preco,
      plano,
      loja: await lojaParaProvider(supabase, loja),
    });

    // Persiste o novo plano_id (billing-intent); NÃO escreve assinatura_status (RN-2).
    await persistirAssinaturaLoja(svc, loja.id, {
      billing_provider: nomeProviderBillingAtivo(),
      provider_subscription_id: loja.provider_subscription_id,
      plano_id: plano.id,
    });

    return { ok: true };
  } catch (e) {
    console.error("[trocarPlano]", e);
    return {
      ok: false,
      erro: "Não foi possível trocar o plano. Tente novamente.",
    };
  }
}

/**
 * Atualiza o meio de pagamento: devolve a URL do checkout HOSPEDADO do provider
 * — dados de cartão nunca tocam o iRango (RN-11). Sem assinatura → erro.
 */
export async function atualizarMeioPagamentoAssinatura(): Promise<ResultadoAssinatura> {
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    if (loja.provider_subscription_id == null) {
      return { ok: false, erro: "Nenhuma assinatura ativa." };
    }

    const { url } = await providerBillingAtivo().urlMeioPagamento(
      loja.provider_subscription_id,
    );
    return { ok: true, url };
  } catch (e) {
    console.error("[atualizarMeioPagamentoAssinatura]", e);
    return {
      ok: false,
      erro: "Não foi possível abrir o pagamento. Tente novamente.",
    };
  }
}

/**
 * Cancela a assinatura: só SOLICITA ao provider. NÃO otimista — não escreve
 * `assinatura_status` nem persiste billing (RN-7). O status efetivo ('cancelada')
 * muda só quando o webhook (077) confirmar.
 */
export async function cancelarAssinatura(): Promise<ResultadoAssinatura> {
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    if (loja.provider_subscription_id == null) {
      return { ok: false, erro: "Nenhuma assinatura para cancelar." };
    }

    await providerBillingAtivo().cancelarAssinatura(loja.provider_subscription_id);
    return { ok: true };
  } catch (e) {
    console.error("[cancelarAssinatura]", e);
    return {
      ok: false,
      erro: "Não foi possível cancelar a assinatura. Tente novamente.",
    };
  }
}
