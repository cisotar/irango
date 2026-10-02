"use client";

import { IMaskInput } from "react-imask";

/** Fixo (10 dígitos) ou celular (11); o servidor revalida com a regex do banco. */
const MASCARAS = [{ mask: "(00) 0000-0000" }, { mask: "(00) 00000-0000" }];

/** Telefone com `react-imask` (mesmo estilo do `Input` shadcn, alvo ≥ 44px). */
export function CampoTelefone({
  id,
  value,
  onChange,
  invalido,
  descricaoId,
}: {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  invalido?: boolean;
  descricaoId?: string;
}) {
  return (
    <IMaskInput
      id={id}
      mask={MASCARAS}
      value={value}
      onAccept={(v: string) => onChange(v)}
      inputMode="tel"
      autoComplete="tel-national"
      placeholder="(00) 00000-0000"
      aria-invalid={invalido || undefined}
      aria-describedby={invalido ? descricaoId : undefined}
      className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
    />
  );
}
