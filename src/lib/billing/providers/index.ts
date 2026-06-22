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
