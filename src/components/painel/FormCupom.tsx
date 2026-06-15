"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cupomSchema } from "@/lib/validacoes/cupom";
import { criarCupom, atualizarCupom } from "@/lib/actions/cupom";
import type { Cupom } from "@/lib/supabase/queries/entregaPagamento";

export type CupomInicial = Pick<
  Cupom,
  | "id"
  | "codigo"
  | "tipo"
  | "valor"
  | "pedido_minimo"
  | "usos_maximos"
  | "expira_em"
  | "ativo"
>;

export type FormCupomProps = {
  /** Se presente (com `id`), o form opera em modo edição. */
  inicial?: CupomInicial;
  onSucesso?: () => void;
};

const selectClassName =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Converte ISO (com offset) para o valor de um <input type="datetime-local">. */
function isoParaDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Form de cupom (issue 045). Client component.
 *
 * Valida no client com `cupomSchema` (021) — gate de UX. A Server Action
 * (032) revalida o mesmo schema, deriva `loja_id` do dono e impõe código único
 * no banco; código duplicado retorna "Este código já existe".
 */
export function FormCupom({ inicial, onSucesso }: FormCupomProps) {
  const ehEdicao = inicial?.id != null;

  const [codigo, setCodigo] = useState(inicial?.codigo ?? "");
  const [tipo, setTipo] = useState<"percentual" | "fixo">(
    (inicial?.tipo as "percentual" | "fixo") ?? "percentual",
  );
  const [valor, setValor] = useState(
    inicial?.valor != null ? String(inicial.valor) : "",
  );
  const [pedidoMinimo, setPedidoMinimo] = useState(
    inicial?.pedido_minimo != null ? String(inicial.pedido_minimo) : "0",
  );
  const [usosMaximos, setUsosMaximos] = useState(
    inicial?.usos_maximos != null ? String(inicial.usos_maximos) : "",
  );
  const [dataFim, setDataFim] = useState(
    isoParaDatetimeLocal(inicial?.expira_em ?? null),
  );
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);

  const [enviando, startEnvio] = useTransition();

  function montarPayload() {
    return {
      codigo: codigo.trim(),
      tipo,
      valor: Number(valor.replace(",", ".")),
      pedido_minimo: Number(pedidoMinimo.replace(",", ".")) || 0,
      usos_maximos: usosMaximos.trim() ? Number(usosMaximos) : null,
      // datetime-local não tem timezone; new Date(...).toISOString() resolve para
      // o offset local e produz ISO com 'Z' (offset:true aceito pelo schema).
      expira_em: dataFim ? new Date(dataFim).toISOString() : null,
      ativo,
    };
  }

  function salvar() {
    const parsed = cupomSchema.safeParse(montarPayload());
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Confira os dados do cupom.");
      return;
    }

    startEnvio(async () => {
      const resultado =
        ehEdicao && inicial?.id
          ? await atualizarCupom(inicial.id, parsed.data)
          : await criarCupom(parsed.data);

      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Cupom salvo!");
      onSucesso?.();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="cupom-codigo">Código</Label>
        <Input
          id="cupom-codigo"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          placeholder="Ex.: BEMVINDO10"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cupom-tipo">Tipo</Label>
        <select
          id="cupom-tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "percentual" | "fixo")}
          className={selectClassName}
        >
          <option value="percentual">Percentual (%)</option>
          <option value="fixo">Valor fixo (R$)</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cupom-valor">
          {tipo === "percentual" ? "Valor (%)" : "Valor (R$)"}
        </Label>
        <Input
          id="cupom-valor"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={tipo === "percentual" ? "10" : "5,00"}
          inputMode="decimal"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cupom-minimo">Pedido mínimo (R$)</Label>
        <Input
          id="cupom-minimo"
          value={pedidoMinimo}
          onChange={(e) => setPedidoMinimo(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cupom-usos">Usos máximos (opcional)</Label>
        <Input
          id="cupom-usos"
          value={usosMaximos}
          onChange={(e) => setUsosMaximos(e.target.value)}
          placeholder="Ilimitado se vazio"
          inputMode="numeric"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cupom-data-fim">Data de expiração (opcional)</Label>
        <Input
          id="cupom-data-fim"
          type="datetime-local"
          value={dataFim}
          onChange={(e) => setDataFim(e.target.value)}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={ativo}
          onCheckedChange={(v) => setAtivo(v === true)}
        />
        <span className="text-foreground">Cupom ativo</span>
      </label>

      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar cupom"}
      </Button>
    </form>
  );
}
