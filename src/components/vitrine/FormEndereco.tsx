"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IMaskInput } from "react-imask";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buscarCep as consultarViaCep, limparCep } from "@/lib/utils/buscarCep";

/** Endereço de entrega montado no client (preview de UX; servidor revalida). */
export type EnderecoEntrega = {
  cep: string;
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type FormEnderecoProps = {
  /** Recebe o endereço completo, ou `null` enquanto algum obrigatório falta. */
  onEnderecoChange: (endereco: EnderecoEntrega | null) => void;
  /**
   * (001) Endereço persistido (estado.endereco do wizard) para HIDRATAR os
   * campos na montagem. Garante o invariante RN-1-A/C: o form reflete o que o
   * estado guarda — sem fantasma. Lido só na montagem (estado inicial do
   * useState); mudanças posteriores da prop não resetam o que o cliente digita.
   */
  enderecoInicial?: EnderecoEntrega | null;
};

/**
 * (001) Função PURA: monta o endereço completo a partir dos campos, ou `null`
 * se algum obrigatório falta. Fonte única do "form completo ⇒ endereço; form
 * incompleto ⇒ null" (RN-1-B). O CEP é preservado CRU (com máscara); os demais
 * sofrem trim. Extraída p/ ser testável em ambiente node (sem DOM).
 */
export function montarEnderecoCompleto(campos: {
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}): EnderecoEntrega | null {
  const { cep, rua, numero, complemento, bairro, cidade, uf } = campos;
  const obrigatorios = [cep, rua, numero, bairro, cidade, uf];
  if (!obrigatorios.every((v) => v.trim().length > 0)) return null;
  return {
    cep,
    rua: rua.trim(),
    numero: numero.trim(),
    complemento: complemento.trim() || undefined,
    bairro: bairro.trim(),
    cidade: cidade.trim(),
    uf: uf.trim(),
  };
}

export function FormEndereco({
  onEnderecoChange,
  enderecoInicial,
}: FormEnderecoProps) {
  // Hidratação na montagem (RN-1-A): inicia os campos com o endereço persistido,
  // se houver. Lazy init — só vale no primeiro render; não reseta digitação.
  const [cep, setCep] = useState(enderecoInicial?.cep ?? "");
  const [rua, setRua] = useState(enderecoInicial?.rua ?? "");
  const [numero, setNumero] = useState(enderecoInicial?.numero ?? "");
  const [complemento, setComplemento] = useState(
    enderecoInicial?.complemento ?? "",
  );
  const [bairro, setBairro] = useState(enderecoInicial?.bairro ?? "");
  const [cidade, setCidade] = useState(enderecoInicial?.cidade ?? "");
  const [uf, setUf] = useState(enderecoInicial?.uf ?? "");

  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const numeroRef = useRef<HTMLInputElement>(null);

  // Notifica o pai: endereço completo só quando todos obrigatórios estão
  // preenchidos. Reusa montarEnderecoCompleto (fonte única, RN-1-B). Roda também
  // na montagem com os valores hidratados → emite o endereço persistido (paridade
  // form↔estado, RN-1-A), ou null quando o form está vazio (sem fantasma).
  useEffect(() => {
    onEnderecoChange(
      montarEnderecoCompleto({ cep, rua, numero, complemento, bairro, cidade, uf }),
    );
  }, [cep, rua, numero, complemento, bairro, cidade, uf, onEnderecoChange]);

  const buscarCep = useCallback(async () => {
    if (limparCep(cep).length !== 8) {
      setErro("CEP não encontrado");
      return;
    }
    setBuscando(true);
    setErro(null);
    const dados = await consultarViaCep(cep);
    setBuscando(false);
    if (dados == null) {
      setErro("CEP não encontrado");
      return;
    }
    setRua(dados.rua);
    setBairro(dados.bairro);
    setCidade(dados.cidade);
    setUf(dados.uf);
    // Foco vai para "Número" — próximo dado que só o usuário tem (mockup).
    numeroRef.current?.focus();
  }, [cep]);

  return (
    // Formulário isolado para quebrar o escopo de autofill do browser:
    // impede que autocomplete do campo "nome" (fora deste form) sobrescreva endereço.
    <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
      <p className="text-sm font-medium text-foreground">Endereço de entrega</p>

      <div className="flex flex-col gap-1">
        <label htmlFor="endereco-cep" className="text-xs text-muted-foreground">
          CEP
        </label>
        <div className="flex gap-2">
          <IMaskInput
            id="endereco-cep"
            mask="00000-000"
            value={cep}
            onAccept={(value: string) => setCep(value)}
            inputMode="numeric"
            placeholder="00000-000"
            aria-invalid={erro != null}
            aria-describedby={erro != null ? "endereco-cep-erro" : undefined}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
          />
          <Button
            type="button"
            variant="outline"
            onClick={buscarCep}
            disabled={buscando}
            className="min-h-11 shrink-0"
          >
            {buscando ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Search aria-hidden />
            )}
            {buscando ? "Buscando…" : "Buscar"}
          </Button>
        </div>
        {erro != null && (
          <p id="endereco-cep-erro" className="text-xs text-destructive">
            {erro} Confira e tente de novo, ou preencha manualmente.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="endereco-rua" className="text-xs text-muted-foreground">
          Rua
        </label>
        <Input
          id="endereco-rua"
          value={rua}
          onChange={(e) => setRua(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="endereco-bairro"
            className="text-xs text-muted-foreground"
          >
            Bairro
          </label>
          <Input
            id="endereco-bairro"
            value={bairro}
            onChange={(e) => setBairro(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="endereco-cidade"
            className="text-xs text-muted-foreground"
          >
            Cidade
          </label>
          <Input
            id="endereco-cidade"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="endereco-numero"
            className="text-xs text-muted-foreground"
          >
            Número
          </label>
          <Input
            id="endereco-numero"
            ref={numeroRef}
            value={numero}
            inputMode="numeric"
            onChange={(e) => setNumero(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="endereco-complemento"
            className="text-xs text-muted-foreground"
          >
            Complemento
          </label>
          <Input
            id="endereco-complemento"
            value={complemento}
            placeholder="opcional"
            onChange={(e) => setComplemento(e.target.value)}
          />
        </div>
      </div>
    </form>
  );
}
