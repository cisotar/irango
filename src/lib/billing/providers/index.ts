import "server-only";
import type { BillingProvider } from "../tipos";

/**
 * Seletor de provider por nome (fail-closed: nome desconhecido lança, nunca
 * autoriza silenciosamente um provider mal configurado). Lazy `require` para não
 * arrastar `asaas.ts` (server-only) ao grafo de um provider não usado.
 */
export function getBillingProvider(provider: string): BillingProvider {
  if (provider === "asaas") {
    const { asaasProvider } = require("./asaas") as typeof import("./asaas");
    return asaasProvider;
  }
  throw new Error(`Provider de billing desconhecido: ${provider}`);
}
