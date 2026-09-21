"use client";

import { Clock, Dot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useLojaAberta } from "@/hooks/useLojaAberta";

type BadgeStatusProps = {
  horarios: Parameters<typeof useLojaAberta>[0];
  timezone: string;
};

/**
 * Os três tons de SISTEMA deste badge (design-system §8): verde = disponível
 * agora, âmbar = requer ação do lojista, neutro = ausência de atividade.
 * Nenhum vem do tema da loja — o status precisa significar a mesma coisa em
 * qualquer loja. O vermelho não existe aqui de propósito (design §13.3).
 */
const TONS = {
  // Cores exatas do design-claude (badge "Aberto agora").
  verde: "border-[#86efac] bg-[#dcfce7] text-[#166534]",
  // Mesmo par de `pendente` em `TabelaPedidos` — uma cor por semântica.
  ambar: "border-transparent bg-amber-100 text-amber-800",
  neutro: "border-[#e5e0d5] bg-[#eeeae0] text-[#6b5d4f]",
} as const;

export type TomBadgeStatus = keyof typeof TONS;

type BadgeEstadoSistemaProps = {
  tom: TomBadgeStatus;
  /** O texto carrega a informação inteira — cor nunca é o dado (WCAG 1.4.1). */
  rotulo: string;
  /** `aria-label` completo quando o rótulo é abreviado. */
  rotuloAcessivel?: string | null;
};

/**
 * A metade APRESENTACIONAL do `BadgeStatus`: recebe tom + texto já decididos e
 * só pinta. É o que o painel consome (issue 256) para dizer o estado de um
 * cardápio sem inventar um badge novo nem uma cor nova — o `BadgeStatus`
 * abaixo passou a renderizar através dela, então os dois mundos dividem
 * literalmente a mesma paleta.
 *
 * Não decide nada: quem decide "aberto agora" é `lojaAberta` na vitrine e
 * `estadoDoCardapio` no painel, sempre com o relógio e o fuso do servidor.
 */
export function BadgeEstadoSistema({
  tom,
  rotulo,
  rotuloAcessivel,
}: BadgeEstadoSistemaProps) {
  const Icone = tom === "verde" ? Dot : Clock;
  return (
    <Badge
      className={`${TONS[tom]} font-bold`}
      aria-label={rotuloAcessivel ?? undefined}
    >
      <Icone aria-hidden className="size-3.5" />
      {rotulo}
    </Badge>
  );
}

/**
 * Status de funcionamento da loja (vitrine). Cores são de SISTEMA — não vêm do
 * tema da loja (design-system §8): verde = aberto, cinza = fechado. Sempre
 * cor + texto + ícone (nunca só cor — WCAG, badge-status.md §5).
 */
export function BadgeStatus({ horarios, timezone }: BadgeStatusProps) {
  const { aberta, proximaAbertura } = useLojaAberta(horarios, timezone);

  if (aberta) {
    return <BadgeEstadoSistema tom="verde" rotulo="Aberto agora" />;
  }

  return (
    <BadgeEstadoSistema
      tom="neutro"
      rotulo={
        proximaAbertura ? `Fechado · abre às ${proximaAbertura}` : "Fechado"
      }
    />
  );
}
