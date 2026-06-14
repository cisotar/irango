"use client";

import { Clock, Dot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useLojaAberta } from "@/hooks/useLojaAberta";

type BadgeStatusProps = {
  horarios: Parameters<typeof useLojaAberta>[0];
  timezone: string;
};

/**
 * Status de funcionamento da loja (vitrine). Cores são de SISTEMA — não vêm do
 * tema da loja (design-system §8): verde = aberto, cinza = fechado. Sempre
 * cor + texto + ícone (nunca só cor — WCAG, badge-status.md §5).
 */
export function BadgeStatus({ horarios, timezone }: BadgeStatusProps) {
  const { aberta, proximaAbertura } = useLojaAberta(horarios, timezone);

  if (aberta) {
    // Cores exatas do design-claude (badge "Aberto agora"): #dcfce7/#166534/#86efac.
    return (
      <Badge className="border-[#86efac] bg-[#dcfce7] font-bold text-[#166534]">
        <Dot aria-hidden className="size-3.5" />
        Aberto agora
      </Badge>
    );
  }

  return (
    <Badge className="border-[#e5e0d5] bg-[#eeeae0] font-bold text-[#6b5d4f]">
      <Clock aria-hidden className="size-3.5" />
      Fechado
      {proximaAbertura ? ` · abre às ${proximaAbertura}` : null}
    </Badge>
  );
}
