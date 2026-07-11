"use server";

// FRONTEIRA DE INTENÇÃO DO ADMIN SaaS (issue 151). Variante ESCOPADA POR `lojaId`
// das actions do lojista (078): o dono do SaaS DISPARA intenções de billing
// (iniciar / trocar / atualizar pagamento / cancelar) sobre a LOJA-ALVO, nunca a
// própria. Duas DIVERGÊNCIAS críticas frente ao lojista (a razão de ser da issue):
//
//   1. ESCOPO por `lojaId`, nunca `auth.uid()`. No lojista o autenticado É o dono;
//      no admin o autenticado é o dono do SaaS operando a loja de OUTRO. A loja-alvo
//      vem de `buscarLojaAdminPorId(svc, lojaId)` — JAMAIS `buscarLojaDoDono`, que
//      operaria a assinatura do PRÓPRIO admin (bug de isolamento).
//   2. E-MAIL do provider = e-mail do DONO da loja-alvo. `lojaParaProvider` do
//      lojista puxa `auth.getUser()` (e-mail do AUTENTICADO); no admin isso mandaria
//      o e-mail do admin ao provider (customer errado). Aqui o e-mail é resolvido de
//      `loja.dono_id` server-side via `resolverEmailDoDono`.
//
// Invariantes herdadas do lojista (seguranca.md §9, RN-1/RN-2/RN-7):
//   - PREÇO: lido EXCLUSIVAMENTE de `planos.preco` (RN-1); `.strict()` rejeita
//     `preco`/`value` injetado no payload — o cliente manda só `plano_id`.
//   - STATUS: nenhuma das 4 actions escreve `assinatura_status` — só o webhook (077)
//     é a autoridade. `cancelar` NÃO é otimista (não persiste).
//   - ESCRITA das colunas billing-intent via SERVICE_ROLE (`persistirAssinaturaLoja`),
//     porque o trigger `lojas_protege_billing` bloqueia o role autenticado. NUNCA
//     via `escopo.atualizarLoja`, que descartaria essas colunas.
//   - DADOS DE CARTÃO nunca trafegam: atualizar pagamento devolve só a URL do
//     checkout hospedado do provider (RN-11).
//
// Ordem fail-closed (D-4): validar `lojaId` (z.guid) → validar payload (.strict())
// → prepararContextoAdmin FORA do try (prova admin PROPAGA se falhar; svc só nasce
// depois) → try { leitura/provider/escrita } catch → genérico (§14).
//
// Mandato `use-server-export-constraint`: este arquivo só pode exportar funções
// `async` — nenhuma `const`/`type` exportada (quebraria só no `next build`).

import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  registrarAcessoAdmin,
} from "@/lib/actions/admin-loja";
import {
  buscarLojaAdminPorId,
  persistirAssinaturaLoja,
  resolverEmailDoDono,
} from "@/lib/supabase/queries/lojas";
import { buscarPlanoAtivo } from "@/lib/supabase/queries/planos";
import {
  providerBillingAtivo,
  nomeProviderBillingAtivo,
} from "@/lib/billing/providers";
import { iniciarAssinaturaSchema } from "@/lib/validacoes/assinatura";
import type { LojaParaProvider } from "@/lib/billing/tipos";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

type ResultadoAssinaturaAdmin =
  | { ok: true }
  | { ok: true; url: string }
  | { ok: false; erro: string };

// `svc` cru devolvido por `prepararContextoAdmin` (service_role). Tipo inferido —
// não-exportado (mandato 'use server').
type Svc = Awaited<ReturnType<typeof prepararContextoAdmin>>["svc"];

/**
 * Variante ADMIN de `lojaParaProvider`: monta o `loja` agnóstico com o e-mail do
 * DONO-ALVO (`loja.dono_id`), resolvido server-side — NUNCA `auth.getUser()` do
 * admin autenticado. Defensivo: dono sem e-mail → "".
 */
async function lojaParaProviderAdmin(
  svc: Svc,
  loja: LojaCompleta,
): Promise<LojaParaProvider> {
  const email = (await resolverEmailDoDono(svc, loja.dono_id)) ?? "";
  return { id: loja.id, nome: loja.nome, email };
}

/**
 * Inicia a assinatura da loja-alvo: valida loja/payload → prova admin → lê a
 * loja-alvo por id → guard double-init → lê preço do banco → cria no provider
 * (e-mail do dono-alvo) → persiste billing-intent via service_role.
 */
export async function iniciarAssinaturaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoAssinaturaAdmin> {
  // 1) `lojaId` (z.guid) ANTES de qualquer efeito (D-4).
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) return { ok: false, erro: "Loja inválida." };

  // 2) `.strict()` rejeita valor/preço injetado ANTES de qualquer I/O (RN-1, §10).
  const parsed = iniciarAssinaturaSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Plano inválido." };
  const { plano_id } = parsed.data;

  // 3) Prova de admin FORA do try → propaga se falhar; svc só nasce depois (D-4).
  const { svc } = await prepararContextoAdmin(validacao.lojaId);

  try {
    // 4) Loja-ALVO por id (svc), NUNCA `buscarLojaDoDono` (derivaria a do admin).
    const loja = await buscarLojaAdminPorId(svc, validacao.lojaId);
    if (loja == null) return { ok: false, erro: "Loja não encontrada." };

    // 5) GUARD double-init: já tem assinatura → não recria. SEM tocar o provider.
    if (loja.provider_subscription_id != null) {
      return { ok: false, erro: "Assinatura já iniciada." };
    }

    // 6) Preço AUTORITATIVO do banco (RN-1). Plano inativo/inexistente → barra.
    const plano = await buscarPlanoAtivo(svc, plano_id);
    if (plano == null) return { ok: false, erro: "Plano indisponível." };

    // 7) Cria no provider com `value` = planos.preco (NUNCA do payload) e o e-mail
    //    do DONO-ALVO (NUNCA do admin autenticado).
    const { subscriptionId } = await providerBillingAtivo().criarAssinatura({
      value: plano.preco,
      plano,
      loja: await lojaParaProviderAdmin(svc, loja),
    });

    // 8) Persiste billing-intent via service_role. SEM assinatura_status (RN-2).
    await persistirAssinaturaLoja(svc, loja.id, {
      billing_provider: nomeProviderBillingAtivo(),
      provider_subscription_id: subscriptionId,
      plano_id: plano.id,
    });

    registrarAcessoAdmin(svc, {
      lojaId: validacao.lojaId,
      acao: "iniciar_assinatura",
      metadados: { plano_id: plano.id },
    });
    revalidarLojaAdmin(validacao.lojaId);
    return { ok: true };
  } catch (e) {
    // §14: erro interno NUNCA vaza ao cliente — log no servidor, msg genérica.
    console.error("[iniciarAssinaturaAdmin]", e);
    return {
      ok: false,
      erro: "Não foi possível iniciar a assinatura. Tente novamente.",
    };
  }
}

/**
 * Troca o plano da loja-alvo: EXIGE assinatura ativa. Atualiza no provider com o
 * preço do banco; status efetivo só muda quando o webhook (077) confirmar.
 */
export async function trocarPlanoAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoAssinaturaAdmin> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = iniciarAssinaturaSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Plano inválido." };
  const { plano_id } = parsed.data;

  const { svc } = await prepararContextoAdmin(validacao.lojaId);

  try {
    const loja = await buscarLojaAdminPorId(svc, validacao.lojaId);
    if (loja == null) return { ok: false, erro: "Loja não encontrada." };
    if (loja.provider_subscription_id == null) {
      return { ok: false, erro: "Nenhuma assinatura ativa para trocar." };
    }

    const plano = await buscarPlanoAtivo(svc, plano_id);
    if (plano == null) return { ok: false, erro: "Plano indisponível." };

    await providerBillingAtivo().atualizarAssinatura({
      subscriptionId: loja.provider_subscription_id,
      value: plano.preco,
      plano,
      loja: await lojaParaProviderAdmin(svc, loja),
    });

    // Persiste o novo plano_id mantendo o subId existente; SEM assinatura_status (RN-2).
    await persistirAssinaturaLoja(svc, loja.id, {
      billing_provider: nomeProviderBillingAtivo(),
      provider_subscription_id: loja.provider_subscription_id,
      plano_id: plano.id,
    });

    registrarAcessoAdmin(svc, {
      lojaId: validacao.lojaId,
      acao: "trocar_plano",
      metadados: { plano_id: plano.id },
    });
    revalidarLojaAdmin(validacao.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[trocarPlanoAdmin]", e);
    return {
      ok: false,
      erro: "Não foi possível trocar o plano. Tente novamente.",
    };
  }
}

/**
 * Atualiza o meio de pagamento da loja-alvo: devolve a URL do checkout HOSPEDADO
 * do provider — dados de cartão nunca tocam o iRango (RN-11). NÃO muda estado:
 * não persiste nem revalida. Sem assinatura → erro.
 */
export async function atualizarMeioPagamentoAssinaturaAdmin(
  lojaId: string,
): Promise<ResultadoAssinaturaAdmin> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) return { ok: false, erro: "Loja inválida." };

  const { svc } = await prepararContextoAdmin(validacao.lojaId);

  try {
    const loja = await buscarLojaAdminPorId(svc, validacao.lojaId);
    if (loja == null) return { ok: false, erro: "Loja não encontrada." };
    if (loja.provider_subscription_id == null) {
      return { ok: false, erro: "Nenhuma assinatura ativa." };
    }

    const { url } = await providerBillingAtivo().urlMeioPagamento(
      loja.provider_subscription_id,
    );
    return { ok: true, url };
  } catch (e) {
    console.error("[atualizarMeioPagamentoAssinaturaAdmin]", e);
    return {
      ok: false,
      erro: "Não foi possível abrir o pagamento. Tente novamente.",
    };
  }
}

/**
 * Cancela a assinatura da loja-alvo: só SOLICITA ao provider. NÃO otimista — não
 * escreve `assinatura_status` nem persiste billing (RN-7). O status efetivo
 * ('cancelada') muda só quando o webhook (077) confirmar.
 */
export async function cancelarAssinaturaAdmin(
  lojaId: string,
): Promise<ResultadoAssinaturaAdmin> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) return { ok: false, erro: "Loja inválida." };

  const { svc } = await prepararContextoAdmin(validacao.lojaId);

  try {
    const loja = await buscarLojaAdminPorId(svc, validacao.lojaId);
    if (loja == null) return { ok: false, erro: "Loja não encontrada." };
    if (loja.provider_subscription_id == null) {
      return { ok: false, erro: "Nenhuma assinatura para cancelar." };
    }

    await providerBillingAtivo().cancelarAssinatura(loja.provider_subscription_id);

    registrarAcessoAdmin(svc, {
      lojaId: validacao.lojaId,
      acao: "cancelar_assinatura",
    });
    revalidarLojaAdmin(validacao.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[cancelarAssinaturaAdmin]", e);
    return {
      ok: false,
      erro: "Não foi possível cancelar a assinatura. Tente novamente.",
    };
  }
}
