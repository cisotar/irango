import type { StatusAssinatura } from "@/lib/utils/assinatura";

/**
 * Rótulos e variantes de Badge por status de assinatura (issue 081). Centraliza
 * a apresentação para o card e o aviso não duplicarem o mapa. Só APRESENTAÇÃO —
 * a regra de transição vive em `assinatura.ts` (não recriar aqui).
 */

export const STATUS_CONHECIDOS: readonly StatusAssinatura[] = [
  "trial",
  "ativa",
  "inadimplente",
  "cancelada",
  "suspensa",
  "cortesia",
];

export const ROTULO_STATUS: Record<StatusAssinatura, string> = {
  trial: "Período de teste",
  ativa: "Ativa",
  inadimplente: "Pagamento pendente",
  cancelada: "Cancelada",
  suspensa: "Suspensa",
  cortesia: "Cortesia",
};

// "secondary" = ok; "destructive" = exige ação; "outline" = encerrado/desconhecido.
export const VARIANTE_STATUS: Record<
  StatusAssinatura,
  "secondary" | "destructive" | "outline"
> = {
  trial: "secondary",
  ativa: "secondary",
  inadimplente: "destructive",
  cancelada: "outline",
  suspensa: "destructive",
  cortesia: "secondary",
};

/** Estados que BLOQUEIAM a loja e exigem regularização (spec §Assinatura). */
export const STATUS_BLOQUEADO: readonly StatusAssinatura[] = [
  "inadimplente",
  "suspensa",
];

export function ehStatusConhecido(s: string): s is StatusAssinatura {
  return STATUS_CONHECIDOS.includes(s as StatusAssinatura);
}

export function ehStatusBloqueado(s: string): boolean {
  return STATUS_BLOQUEADO.includes(s as StatusAssinatura);
}

/** Tem assinatura "em vigor" (não cancelada nem nunca iniciada)? */
export function temAssinaturaAtiva(
  status: string,
  providerSubscriptionId: string | null,
): boolean {
  return providerSubscriptionId != null && status !== "cancelada";
}
