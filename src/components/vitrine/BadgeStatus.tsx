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
    return (
      <Badge className="border-transparent bg-green-100 text-green-800">
        <Dot aria-hidden className="size-3.5" />
        Aberto agora
      </Badge>
    );
  }

  return (
    <Badge className="border-transparent bg-gray-100 text-gray-700">
      <Clock aria-hidden className="size-3.5" />
      Fechado
      {proximaAbertura ? ` · abre às ${proximaAbertura}` : null}
    </Badge>
  );
}
