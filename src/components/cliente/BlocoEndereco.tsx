"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormEndereco, type EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import type { EntradaEnderecoCliente } from "@/lib/validacoes/cliente";

const SUGESTOES_ROTULO = ["Casa", "Trabalho", "Outro"] as const;

/**
 * Rótulo livre (com atalhos Casa/Trabalho/Outro) + `FormEndereco` reusado SEM
 * alteração (o rótulo fica num Input irmão — spec). Emite o endereço completo
 * ou `null`. É preview de UX: a Server Action revalida com
 * `schemaEnderecoCliente`. Só uma instância por tela (FormEndereco usa ids fixos).
 */
export function BlocoEndereco({
  rotuloInicial = "",
  enderecoInicial,
  onChange,
}: {
  rotuloInicial?: string;
  enderecoInicial?: EnderecoEntrega | null;
  onChange: (endereco: EntradaEnderecoCliente | null) => void;
}) {
  const [rotulo, setRotulo] = useState(rotuloInicial);
  const [endereco, setEndereco] = useState<EnderecoEntrega | null>(enderecoInicial ?? null);

  // Estável: FormEndereco chama onEnderecoChange num effect que depende dela.
  const aoMudarEndereco = useCallback((e: EnderecoEntrega | null) => setEndereco(e), []);

  useEffect(() => {
    const r = rotulo.trim();
    onChange(endereco && r ? { ...endereco, rotulo: r } : null);
  }, [rotulo, endereco, onChange]);

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2">
        <Label htmlFor="endereco-rotulo">Rótulo</Label>
        <Input
          id="endereco-rotulo"
          value={rotulo}
          maxLength={30}
          className="min-h-11"
          onChange={(e) => setRotulo(e.target.value.replace(/[\r\n]/g, ""))}
        />
        <div className="flex flex-wrap gap-2">
          {SUGESTOES_ROTULO.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={rotulo.trim() === s}
              onClick={() => setRotulo(s)}
              className="min-h-11 rounded-full border border-input px-4 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primaria aria-pressed:bg-primaria aria-pressed:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <FormEndereco onEnderecoChange={aoMudarEndereco} enderecoInicial={enderecoInicial} />
    </div>
  );
}
