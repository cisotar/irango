"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { schemaHorarios } from "@/lib/validacoes/loja";
import { salvarHorarios as salvarHorariosLojista } from "@/lib/actions/loja";
import { lojaAberta, type DiaHorario, type Horarios } from "@/lib/utils/lojaAberta";

type DiaKey = keyof Horarios;

const DIAS: { chave: DiaKey; rotulo: string }[] = [
  { chave: "seg", rotulo: "Segunda" },
  { chave: "ter", rotulo: "Terça" },
  { chave: "qua", rotulo: "Quarta" },
  { chave: "qui", rotulo: "Quinta" },
  { chave: "sex", rotulo: "Sexta" },
  { chave: "sab", rotulo: "Sábado" },
  { chave: "dom", rotulo: "Domingo" },
];

const DIA_PADRAO: DiaHorario = { abre: "08:00", fecha: "18:00", ativo: false };

/** Normaliza o jsonb carregado, preenchendo dias ausentes com o padrão. */
function normalizar(inicial: Horarios | null): Horarios {
  const base = {} as Horarios;
  for (const { chave } of DIAS) {
    const d = inicial?.[chave];
    base[chave] =
      d && typeof d === "object"
        ? {
            abre: d.abre ?? DIA_PADRAO.abre,
            fecha: d.fecha ?? DIA_PADRAO.fecha,
            ativo: Boolean(d.ativo),
          }
        : { ...DIA_PADRAO };
  }
  return base;
}

/**
 * Grade de horários (issue 041). Client component.
 *
 * Preview de "Aberta agora" usa a função pura `lojaAberta` (011) sobre o estado
 * local e o `timezone` da loja. Salva via `salvarHorarios` (030), que revalida
 * o mesmo `schemaHorarios` e a regra `abre < fecha` no servidor.
 */
export function HorariosClient({
  inicial,
  timezone,
  onSalvar = salvarHorariosLojista,
}: {
  inicial: Horarios | null;
  timezone: string;
  /** Action de salvar horários. Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onSalvar?: typeof salvarHorariosLojista;
}) {
  const router = useRouter();
  const [horarios, setHorarios] = useState<Horarios>(() => normalizar(inicial));
  const [enviando, startEnvio] = useTransition();

  const status = useMemo(
    () => lojaAberta(horarios, new Date(), timezone),
    [horarios, timezone],
  );

  function atualizarDia(chave: DiaKey, patch: Partial<DiaHorario>) {
    setHorarios((atual) => ({
      ...atual,
      [chave]: { ...atual[chave], ...patch },
    }));
  }

  function salvar() {
    const parsed = schemaHorarios.safeParse(horarios);
    if (!parsed.success) {
      toast.error("Verifique os horários: a abertura deve ser antes do fechamento.");
      return;
    }

    startEnvio(async () => {
      const resultado = await onSalvar(parsed.data);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Horários salvos!");
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Horários
        </h1>
        <Badge variant={status.aberta ? "secondary" : "outline"}>
          {status.aberta
            ? "Aberta agora"
            : status.reabreEm
              ? `Fechada · reabre ${status.reabreEm}`
              : "Fechada"}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <div className="divide-y divide-foreground/10">
              {DIAS.map(({ chave, rotulo }) => {
                const dia = horarios[chave];
                return (
                  <div
                    key={chave}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <label className="flex w-32 cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={dia.ativo}
                        onCheckedChange={(v) =>
                          atualizarDia(chave, { ativo: v === true })
                        }
                        aria-label={`${rotulo} aberto`}
                      />
                      <span className="font-medium text-foreground">
                        {rotulo}
                      </span>
                    </label>

                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={dia.abre}
                        disabled={!dia.ativo}
                        aria-label={`Abertura ${rotulo}`}
                        onChange={(e) =>
                          atualizarDia(chave, { abre: e.target.value })
                        }
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground">às</span>
                      <Input
                        type="time"
                        value={dia.fecha}
                        disabled={!dia.ativo}
                        aria-label={`Fechamento ${rotulo}`}
                        onChange={(e) =>
                          atualizarDia(chave, { fecha: e.target.value })
                        }
                        className="w-32"
                      />
                    </div>

                    {!dia.ativo && (
                      <span className="text-xs text-muted-foreground">
                        Fechado
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <Separator />
            <div className="p-4">
              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
