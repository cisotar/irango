import type { StatusAssinatura } from "@/lib/utils/assinatura";

/**
 * Fonte ÚNICA da apresentação de status de assinatura (rótulo pt-BR + variante
 * de `Badge`). Consumida pelo card do lojista (`StatusAssinatura.tsx`) e pela
 * tela admin (`/admin/assinantes`) — para que "Suspensa" e sua cor não divirjam
 * entre as duas telas. Só APRESENTAÇÃO: a regra de billing vive em `assinatura.ts`.
 *
 * Variantes (WCAG: sempre cor + texto, nunca só cor):
 *   secondary   = saudável / neutro (ativa, trial, cortesia)
 *   destructive = exige ação (inadimplente, suspensa)
 *   outline     = estado encerrado / desconhecido (cancelada, fallback)
 */
export type VarianteBadge = "secondary" | "destructive" | "outline";

export const STATUS_ASSINATURA_CONHECIDOS: readonly StatusAssinatura[] = [
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

export const VARIANTE_STATUS: Record<StatusAssinatura, VarianteBadge> = {
  trial: "secondary",
  ativa: "secondary",
  inadimplente: "destructive",
  cancelada: "outline",
  suspensa: "destructive",
  cortesia: "secondary",
};

export function ehStatusAssinaturaConhecido(s: string): s is StatusAssinatura {
  return STATUS_ASSINATURA_CONHECIDOS.includes(s as StatusAssinatura);
}

/** Rótulo + variante para QUALQUER string (status desconhecido → "Desconhecida"/outline). */
export function apresentarStatus(s: string): {
  rotulo: string;
  variante: VarianteBadge;
} {
  return ehStatusAssinaturaConhecido(s)
    ? { rotulo: ROTULO_STATUS[s], variante: VARIANTE_STATUS[s] }
    : { rotulo: "Desconhecida", variante: "outline" };
}
