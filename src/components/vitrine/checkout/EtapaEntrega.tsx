"use client";

// Etapa 2 do wizard (issue 077): tipo de entrega + endereço + frete preview.
//
// Retirada → oculta endereço, frete preview = 0, avança direto.
// Entrega → FormEndereco (CEP + ViaCEP) e, ao ter bairro, calcularFreteAction
// (072) para estimar o frete. Fora de área → bloqueia o avanço.
//
// CRÍTICO (seguranca.md §10): o frete exibido é PREVIEW. O servidor (071)
// recalcula do banco e, em retirada, FORÇA frete 0 ignorando endereço (RN-C2).

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormEndereco, type EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { calcularFreteAction } from "@/lib/actions/frete";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { ResumoValores } from "./ResumoValores";
import type { TipoEntrega } from "./estado";

export type EtapaEntregaProps = {
  lojaId: string;
  subtotal: number;
  desconto: number;
  /** false se a loja não aceita entrega (sem zonas e sem fallback fora-de-zona). */
  aceitaEntrega: boolean;
  tipoEntrega: TipoEntrega;
  endereco: EnderecoEntrega | null;
  onTipoEntregaChange: (tipo: TipoEntrega) => void;
  onEnderecoChange: (endereco: EnderecoEntrega | null) => void;
  /** comunica o frete preview ao pai (para o resumo da Etapa 3). */
  onFreteChange: (frete: number) => void;
  onVoltar: () => void;
  onContinuar: () => void;
};

type EstadoFrete =
  | { status: "ocioso" }
  | { status: "calculando" }
  | { status: "ok"; taxa: number; zonaNome: string }
  | { status: "indisponivel" }
  | { status: "erro"; mensagem: string };

export function EtapaEntrega({
  lojaId,
  subtotal,
  desconto,
  aceitaEntrega,
  tipoEntrega,
  endereco,
  onTipoEntregaChange,
  onEnderecoChange,
  onFreteChange,
  onVoltar,
  onContinuar,
}: EtapaEntregaProps) {
  const [frete, setFrete] = useState<EstadoFrete>({ status: "ocioso" });
  const [calculando, startCalculo] = useTransition();
  // Evita recalcular para o mesmo bairro repetidamente.
  const ultimoBairro = useRef<string | null>(null);

  const ehEntrega = tipoEntrega === "entrega";

  // Calcula frete preview quando o bairro está disponível (entrega).
  // sessionStorage/Server Action só rodam no client — disparado por mudança de
  // endereço/tipo, não por render espúrio.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!ehEntrega) {
      // Retirada: frete preview = 0, sempre.
      ultimoBairro.current = null;
      setFrete({ status: "ocioso" });
      onFreteChange(0);
      return;
    }
    const bairro = endereco?.bairro?.trim();
    if (!bairro) {
      ultimoBairro.current = null;
      setFrete({ status: "ocioso" });
      onFreteChange(0);
      return;
    }
    if (bairro === ultimoBairro.current) return;
    ultimoBairro.current = bairro;

    startCalculo(async () => {
      setFrete({ status: "calculando" });
      const r = await calcularFreteAction({ loja_id: lojaId, bairro });
      if (!r.ok) {
        setFrete({ status: "erro", mensagem: r.erro });
        onFreteChange(0);
        return;
      }
      if (r.zona_nome === "indisponivel") {
        setFrete({ status: "indisponivel" });
        onFreteChange(0);
        return;
      }
      const rotulo =
        r.zona_nome === "fora_zona" ? "fora da área de zonas" : r.zona_nome;
      setFrete({ status: "ok", taxa: r.taxa_preview, zonaNome: rotulo });
      onFreteChange(r.taxa_preview);
    });
  }, [ehEntrega, endereco?.bairro, lojaId, onFreteChange]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fretePreview = frete.status === "ok" ? frete.taxa : 0;
  const totalPreview = Math.max(0, subtotal - desconto) + fretePreview;

  // Pode avançar: retirada sempre; entrega exige endereço completo + frete OK.
  const podeAvancar = ehEntrega
    ? endereco !== null && frete.status === "ok" && !calculando
    : true;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-semibold text-foreground">
            Como você quer receber?
          </h2>

          {!aceitaEntrega && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Esta loja oferece apenas <strong>retirada no local</strong>.
            </p>
          )}

          <RadioGroup
            value={tipoEntrega}
            onValueChange={(v) => onTipoEntregaChange(v as TipoEntrega)}
            className="gap-2"
          >
            {aceitaEntrega && (
              <Label
                htmlFor="tipo-entrega"
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
              >
                <RadioGroupItem value="entrega" id="tipo-entrega" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    Entrega
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Receba no seu endereço
                  </span>
                </span>
              </Label>
            )}
            <Label
              htmlFor="tipo-retirada"
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
            >
              <RadioGroupItem value="retirada" id="tipo-retirada" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-foreground">
                  Retirada no local
                </span>
                <span className="block text-xs text-muted-foreground">
                  Sem custo de entrega
                </span>
              </span>
            </Label>
          </RadioGroup>
        </CardContent>
      </Card>

      {ehEntrega && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <FormEndereco onEnderecoChange={onEnderecoChange} />

            {frete.status === "calculando" && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Calculando frete…
              </p>
            )}
            {frete.status === "ok" && (
              <p className="text-xs text-muted-foreground">
                Frete estimado para <strong>{frete.zonaNome}</strong>:{" "}
                {formatarMoeda(frete.taxa)}
              </p>
            )}
            {frete.status === "indisponivel" && (
              <p className="text-xs text-destructive">
                Entrega indisponível para o seu bairro. Tente outro endereço ou
                escolha retirada.
              </p>
            )}
            {frete.status === "erro" && (
              <p className="text-xs text-destructive">{frete.mensagem}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <ResumoValores
            subtotal={subtotal}
            desconto={desconto}
            frete={fretePreview}
            total={totalPreview}
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={onVoltar}
        >
          Voltar
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={!podeAvancar}
          onClick={onContinuar}
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}
