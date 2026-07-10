import "server-only";
import type { BillingProvider } from "../tipos";
import { asaasProvider } from "./asaas";

/**
 * Seletor de provider por nome (fail-closed: nome desconhecido lança, nunca
 * autoriza silenciosamente um provider mal configurado). `asaas.ts` é módulo de
 * funções puras server-only (sem I/O no topo), então o import estático não tem
 * custo de side-effect — e satisfaz `no-require-imports` no CI.
 */
export function getBillingProvider(provider: string): BillingProvider {
  if (provider === "asaas") {
    return asaasProvider;
  }
  throw new Error(`Provider de billing desconhecido: ${provider}`);
}

/**
 * Nome do provider de billing ativo (env, default 'asaas'). Fonte ÚNICA do
 * default — consumido tanto para resolver o objeto provider quanto para gravar
 * `lojas.billing_provider`. Centraliza o literal antes repetido nas actions do
 * lojista (078) e do admin (151): trocar o default é um ponto só.
 */
export function nomeProviderBillingAtivo(): string {
  return process.env.BILLING_PROVIDER ?? "asaas";
}

/** Provider de billing ativo (env, default 'asaas'). Agnóstico. */
export function providerBillingAtivo(): BillingProvider {
  return getBillingProvider(nomeProviderBillingAtivo());
}
