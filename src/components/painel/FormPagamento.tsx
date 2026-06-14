"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { schemaFormaPagamento } from "@/lib/validacoes/pagamento";
import {
  salvarFormaPagamento,
  atualizarFormaPagamento,
} from "@/lib/actions/pagamento";
import type { Json } from "@/lib/database.types";

type TipoChavePix = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export type FormPagamentoProps = {
  tipo: "pix" | "link";
  /** Se presente (com `id`), o form opera em modo edição. */
  inicial?: { id: string; config: Json };
  onSucesso?: () => void;
};

const selectClassName =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Lê com segurança um campo string de um Json desconhecido. */
function lerCampo(config: Json | undefined, campo: string): string {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const v = (config as Record<string, unknown>)[campo];
    if (typeof v === "string") return v;
  }
  return "";
}

/**
 * Form de forma de pagamento Pix/Link (issue 047). Client component.
 *
 * Valida no client com `schemaFormaPagamento` (022) — gate de UX. A Server
 * Action (032/047) revalida o MESMO schema (chave Pix malformada faria o
 * comprador pagar pra ninguém) e deriva `loja_id` do dono.
 */
export function FormPagamento({ tipo, inicial, onSucesso }: FormPagamentoProps) {
  const ehEdicao = inicial?.id != null;

  const [tipoChave, setTipoChave] = useState<TipoChavePix>(
    (lerCampo(inicial?.config, "tipo_chave") as TipoChavePix) || "telefone",
  );
  const [chave, setChave] = useState(lerCampo(inicial?.config, "chave"));
  const [url, setUrl] = useState(lerCampo(inicial?.config, "url"));

  const [enviando, startEnvio] = useTransition();

  function montarPayload() {
    if (tipo === "pix") {
      return { tipo: "pix" as const, config: { tipo_chave: tipoChave, chave: chave.trim() } };
    }
    return { tipo: "link" as const, config: { url: url.trim() } };
  }

  function salvar() {
    const parsed = schemaFormaPagamento.safeParse(montarPayload());
    if (!parsed.success) {
      toast.error(
        tipo === "pix"
          ? "Chave Pix inválida para o tipo selecionado."
          : "Informe uma URL válida.",
      );
      return;
    }

    startEnvio(async () => {
      const resultado =
        ehEdicao && inicial?.id
          ? await atualizarFormaPagamento(inicial.id, parsed.data)
          : await salvarFormaPagamento(parsed.data);

      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Forma de pagamento salva!");
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
      {tipo === "pix" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="pix-tipo-chave">Tipo da chave</Label>
            <select
              id="pix-tipo-chave"
              value={tipoChave}
              onChange={(e) => setTipoChave(e.target.value as TipoChavePix)}
              className={selectClassName}
            >
              <option value="telefone">Telefone</option>
              <option value="email">E-mail</option>
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pix-chave">Chave Pix</Label>
            <Input
              id="pix-chave"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder={
                tipoChave === "telefone"
                  ? "5511999999999"
                  : tipoChave === "email"
                    ? "voce@exemplo.com"
                    : tipoChave === "cpf"
                      ? "Somente números"
                      : tipoChave === "cnpj"
                        ? "Somente números"
                        : "Chave aleatória (UUID)"
              }
              required
            />
          </div>
        </>
      )}

      {tipo === "link" && (
        <div className="space-y-1">
          <Label htmlFor="link-url">URL de pagamento</Label>
          <Input
            id="link-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            required
          />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Ativar"}
      </Button>
    </form>
  );
}
