"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { IMaskInput } from "react-imask";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { inputMascaraClassName } from "@/components/painel/estiloInputMascara";
import {
  schemaRegistroFreteCombinado,
  TETO_FRETE_COMBINADO,
} from "@/lib/validacoes/entrega";
import type { registrarFreteCombinado } from "@/lib/actions/freteCombinado";

/**
 * Tipo da Server Action de registro do frete, derivado da action do lojista. A
 * page admin injeta `registrarFreteCombinadoAdmin.bind(null, lojaId)`, que tem
 * a MESMA forma `(payload) => Promise<ResultadoRegistroFrete>`.
 */
export type AcaoFrete = typeof registrarFreteCombinado;

/**
 * Campo do frete combinado no detalhe do pedido (spec modalidades-entrega-loja).
 * O zod aqui é só gate de UX — a AUTORIDADE é a Server Action, que revalida o
 * mesmo schema, lê subtotal/desconto do banco e recalcula o total. O form envia
 * SÓ `pedidoId` e `valor`.
 */
export function RegistrarFreteCombinado({
  pedidoId,
  acao,
}: {
  pedidoId: string;
  acao: AcaoFrete;
}) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [pendente, startTransition] = useTransition();

  function registrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // `unmask`: o valor chega com ponto decimal ("8.5"), pronto para `Number`.
    const parsed = schemaRegistroFreteCombinado.safeParse({
      pedidoId,
      valor: valor === "" ? Number.NaN : Number(valor),
    });
    if (!parsed.success) {
      toast.error("Digite um valor de frete entre zero e R$ 1.000,00.");
      return;
    }
    startTransition(async () => {
      const resultado = await acao(parsed.data);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Frete registrado.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={registrar} className="space-y-2">
      <Label htmlFor="frete-combinado">Frete combinado (R$)</Label>
      <div className="flex gap-2">
        <IMaskInput
          id="frete-combinado"
          mask={Number}
          scale={2}
          radix=","
          mapToRadix={["."]}
          thousandsSeparator="."
          min={0}
          max={TETO_FRETE_COMBINADO}
          unmask
          value={valor}
          onAccept={(v: string) => setValor(v)}
          inputMode="decimal"
          placeholder="Ex.: 8,50"
          disabled={pendente}
          className={inputMascaraClassName}
        />
        <Button type="submit" disabled={pendente || valor === ""}>
          {pendente && <Loader2 className="mr-2 size-4 animate-spin" />}
          Registrar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Registre o valor que você combinou com o cliente. Depois de registrado, o
        frete não pode ser alterado.
      </p>
    </form>
  );
}
