"use client";

// Dia de início do ciclo mensal (issue 354/358, RN-V08). Molde
// `ModalidadesEntrega` (D11): `useState` + o MESMO `schemaCicloVendas` da
// Server Action como gate de UX, `useTransition`, toast e `router.refresh()`.
// A action é INJETADA (lojista ou admin, D12); a action revalida e o CHECK
// `lojas_dia_inicio_ciclo_check` é a última linha.

import { useId, useState, useTransition, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MSG_CICLO_INVALIDO,
  schemaCicloVendas,
  type DadosCicloVendas,
} from "@/lib/validacoes/vendas";
import type { ResultadoCiclo } from "@/lib/vendas/tipos";

export type CicloMensalProps = {
  diaInicioCiclo: number;
  /** "05/out a 04/nov"; null quando o relatório não carregou. */
  rotuloCicloAtual: string | null;
  salvar: (payload: DadosCicloVendas) => Promise<ResultadoCiclo>;
};

export function CicloMensal({ diaInicioCiclo, rotuloCicloAtual, salvar }: CicloMensalProps): ReactElement {
  const router = useRouter();
  const idCampo = useId();
  const idErro = `${idCampo}-erro`;
  const [valor, setValor] = useState(String(diaInicioCiclo));
  const [salvando, startSalvar] = useTransition();

  const validacao = schemaCicloVendas.safeParse({ dia_inicio_ciclo: Number(valor) });
  const invalido = valor === "" || !validacao.success;
  const alterado = validacao.success && validacao.data.dia_inicio_ciclo !== diaInicioCiclo;

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validacao.success) return;
    const dados = validacao.data;
    startSalvar(async () => {
      const r = await salvar(dados);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Ciclo mensal salvo.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">Ciclo mensal</h2>
          {rotuloCicloAtual != null && (
            <p className="text-sm text-muted-foreground">Ciclo atual: {rotuloCicloAtual}</p>
          )}
        </div>
        <form onSubmit={enviar} className="flex flex-wrap items-end gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idCampo}>Dia de início do ciclo</Label>
            <Input
              id={idCampo}
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              step={1}
              value={valor}
              disabled={salvando}
              aria-invalid={invalido || undefined}
              aria-describedby={invalido ? idErro : undefined}
              onChange={(e) => setValor(e.target.value)}
              className="min-h-[44px] w-24"
            />
          </div>
          <Button type="submit" size="sm" className="min-h-[44px]" disabled={salvando || invalido || !alterado}>
            {salvando && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Salvar ciclo
          </Button>
        </form>
        {invalido && (
          <p id={idErro} className="text-sm text-destructive">
            {MSG_CICLO_INVALIDO}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
