"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ALVO, type PropsEditorZonas } from "@/components/painel/pecasEntrega";
import { zonasDoPayloadBairros } from "@/components/painel/payloadZona";
import { TabelaBairrosEntrega } from "@/components/painel/TabelaBairrosEntrega";
import { TabelaFretePorBairro } from "@/components/painel/TabelaFretePorBairro";

type Vista = "por_bairro" | "por_preco";

const VISTAS: { valor: Vista; rotulo: string }[] = [
  { valor: "por_bairro", rotulo: "Frete por bairro" },
  { valor: "por_preco", rotulo: "Bairros por preço" },
];

/**
 * Frete por bairros com duas vistas dos MESMOS dados (issue 325): uma linha por
 * bairro (abre primeiro) ou bairros agrupados por preço. As duas gravam o mesmo
 * payload de grupos; trocar de vista remonta a outra com o que já foi salvo.
 */
export function EditorBairros(props: PropsEditorZonas) {
  const [vista, setVista] = useState<Vista>("por_bairro");
  const [zonasSalvas, setZonasSalvas] = useState(props.zonasIniciais);

  const aoGravar: PropsEditorZonas["aoGravar"] = (payload) => {
    if (payload.forma === "bairro") setZonasSalvas(zonasDoPayloadBairros(payload));
    props.aoGravar(payload);
  };

  const editor = { ...props, zonasIniciais: zonasSalvas, aoGravar };

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Como cadastrar o frete por bairro" className="flex flex-wrap gap-2">
        {VISTAS.map((v) => (
          <Button
            key={v.valor}
            type="button"
            variant={vista === v.valor ? "default" : "outline"}
            aria-pressed={vista === v.valor}
            className={ALVO}
            onClick={() => setVista(v.valor)}
          >
            {v.rotulo}
          </Button>
        ))}
      </div>
      {vista === "por_bairro" ? (
        <TabelaFretePorBairro key="por_bairro" {...editor} />
      ) : (
        <TabelaBairrosEntrega key="por_preco" {...editor} />
      )}
    </div>
  );
}
