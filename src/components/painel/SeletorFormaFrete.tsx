"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ALVO } from "@/components/painel/pecasEntrega";
import { FORMAS_FRETE, ROTULO_FORMA, type FormaFrete, type FormaGravada } from "@/lib/utils/formaFrete";

const DESCRICAO: Record<FormaFrete, string> = {
  raio_km:
    "Você define só até onde entrega e o preço de cada faixa: o sistema calcula a distância de cada pedido sozinho. Por CEP ou por bairro, você cadastra cada CEP e cada bairro um por um, e o endereço que ficar de fora fica sem entrega.",
  faixa_cep: "Um preço por intervalo de CEP.",
  bairro: "Um preço por grupo de bairros.",
};

/**
 * Escolha da forma de cobrar a entrega (issue 325). Trocar de opção NÃO grava
 * nada: só muda o editor visível. A forma passa a valer na vitrine quando o
 * lojista salva no editor dela (a RPC substitui todas as zonas da loja).
 */
export function SeletorFormaFrete({
  valor,
  gravada,
  aoMudar,
}: {
  valor: FormaFrete;
  gravada: FormaGravada;
  aoMudar: (forma: FormaFrete) => void;
}) {
  const idBase = useId();
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 text-sm font-medium text-foreground">Como você cobra a entrega</legend>
      <RadioGroup
        value={valor}
        onValueChange={(v) => {
          const forma = FORMAS_FRETE.find((f) => f === v);
          if (forma) aoMudar(forma);
        }}
        className="grid gap-2 md:grid-cols-3"
      >
        {FORMAS_FRETE.map((forma) => {
          const id = `${idBase}-${forma}`;
          const marcada = forma === valor;
          return (
            <Label
              key={forma}
              htmlFor={id}
              className={`${ALVO} cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal ${
                marcada ? "border-primary bg-primary/5" : ""
              }`}
            >
              <RadioGroupItem value={forma} id={id} className="mt-0.5" />
              <span className="space-y-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-foreground">{ROTULO_FORMA[forma]}</span>
                  {forma === "raio_km" && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Recomendado
                    </span>
                  )}
                  {forma === gravada && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Valendo na vitrine
                    </span>
                  )}
                </span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {DESCRICAO[forma]}
                </span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
