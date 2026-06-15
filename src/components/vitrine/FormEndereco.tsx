"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IMaskInput } from "react-imask";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
};

/** Resposta relevante do ViaCEP (API pública, sem key — seguranca.md §9). */
type RespostaViaCep = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

/** Só dígitos do CEP (a máquina é apresentação). */
function limparCep(cep: string): string {
  return cep.replace(/\D/g, "");
}

export function FormEndereco({ onEnderecoChange }: FormEnderecoProps) {
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");

  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const numeroRef = useRef<HTMLInputElement>(null);

  // Notifica o pai: endereço completo só quando todos obrigatórios estão preenchidos.
  useEffect(() => {
    const obrigatorios = [cep, rua, numero, bairro, cidade, uf];
    const completo = obrigatorios.every((v) => v.trim().length > 0);
    onEnderecoChange(
      completo
        ? {
            cep,
            rua: rua.trim(),
            numero: numero.trim(),
            complemento: complemento.trim() || undefined,
            bairro: bairro.trim(),
            cidade: cidade.trim(),
            uf: uf.trim(),
          }
        : null,
    );
  }, [cep, rua, numero, complemento, bairro, cidade, uf, onEnderecoChange]);

  const buscarCep = useCallback(async () => {
    const limpo = limparCep(cep);
    if (limpo.length !== 8) {
      setErro("CEP não encontrado");
      return;
    }
    setBuscando(true);
    setErro(null);
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
      if (!resp.ok) {
        setErro("CEP não encontrado");
        return;
      }
      const dados = (await resp.json()) as RespostaViaCep;
      if (dados.erro) {
        setErro("CEP não encontrado");
        return;
      }
      setRua(dados.logradouro ?? "");
      setBairro(dados.bairro ?? "");
      setCidade(dados.localidade ?? "");
      setUf(dados.uf ?? "");
      // Foco vai para "Número" — próximo dado que só o usuário tem (mockup).
      numeroRef.current?.focus();
    } catch (e) {
      // Erro interno nunca vaza ao cliente (seguranca.md §14).
      console.error("[FormEndereco] buscarCep", e);
      setErro("CEP não encontrado");
    } finally {
      setBuscando(false);
    }
  }, [cep]);

  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
