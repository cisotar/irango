"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { schemaFormaPagamento } from "@/lib/validacoes/pagamento";
import {
  salvarFormaPagamento as salvarFormaPagamentoLojista,
  atualizarFormaPagamento as atualizarFormaPagamentoLojista,
  salvarQrPix as salvarQrPixLojista,
} from "@/lib/actions/pagamento";
import {
  UploadQrPix,
  type EnviarQrPix,
} from "@/components/painel/UploadQrPix";
import type { Json } from "@/lib/database.types";

type TipoChavePix = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export type FormPagamentoProps = {
  tipo: "pix" | "link";
  /** Se presente (com `id`), o form opera em modo edição. */
  inicial?: { id: string; config: Json };
  /**
   * ID da loja (derivado do servidor) — necessário para construir o path do
   * bucket `pix-qr` no upload de QR Code (`{lojaId}/qr.{ext}`).
   * Obrigatório quando `tipo === "pix"`.
   */
  lojaId?: string;
  onSucesso?: () => void;
  /** Action de criação. Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onSalvar?: typeof salvarFormaPagamentoLojista;
  /** Action de edição. Default: action do lojista. */
  onAtualizar?: typeof atualizarFormaPagamentoLojista;
  /** Action que persiste a URL do QR Pix. Default: action do lojista. */
  onSalvarQr?: typeof salvarQrPixLojista;
  /**
   * Função de upload do QR injetada para o `UploadQrPix` (variante admin escopa o
   * path do bucket por `lojaId`). Default: upload do lojista via client Supabase.
   */
  onEnviarQr?: EnviarQrPix;
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
 * Form de forma de pagamento Pix/Link (issue 047 + 075). Client component.
 *
 * Valida no client com `schemaFormaPagamento` (022) — gate de UX. A Server
 * Action (032/047) revalida o MESMO schema (chave Pix malformada faria o
 * comprador pagar pra ninguém) e deriva `loja_id` do dono.
 *
 * Para Pix: inclui upload opcional de QR Code (issue 075). O upload ocorre no
 * browser (client Supabase autenticado, RLS do bucket 074 garante o escopo) e
 * persiste a URL via `salvarQrPix` (Server Action) separada do submit principal.
 */
export function FormPagamento({
  tipo,
  inicial,
  lojaId,
  onSucesso,
  onSalvar = salvarFormaPagamentoLojista,
  onAtualizar = atualizarFormaPagamentoLojista,
  onSalvarQr = salvarQrPixLojista,
  onEnviarQr,
}: FormPagamentoProps) {
  const router = useRouter();
  const ehEdicao = inicial?.id != null;

  const [tipoChave, setTipoChave] = useState<TipoChavePix>(
    (lerCampo(inicial?.config, "tipo_chave") as TipoChavePix) || "telefone",
  );
  const [chave, setChave] = useState(lerCampo(inicial?.config, "chave"));
  const [url, setUrl] = useState(lerCampo(inicial?.config, "url"));

  // URL do QR Pix — carregada do config inicial; atualizada após upload.
  const [pixQrUrl, setPixQrUrl] = useState<string>(
    lerCampo(inicial?.config, "pix_qr_url"),
  );

  const [enviando, startEnvio] = useTransition();
  const [salvandoQr, startSalvarQr] = useTransition();

  function montarPayload() {
    if (tipo === "pix") {
      return {
        tipo: "pix" as const,
        config: {
          tipo_chave: tipoChave,
          chave: chave.trim(),
          ...(pixQrUrl ? { pix_qr_url: pixQrUrl } : {}),
        },
      };
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
          ? await onAtualizar(inicial.id, parsed.data)
          : await onSalvar(parsed.data);

      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Forma de pagamento salva!");
      onSucesso?.();
    });
  }

  /**
   * Chamado pelo `UploadQrPix` após upload bem-sucedido. Persiste a URL via
   * Server Action — separado do submit principal para que chave Pix e QR sejam
   * salvos independentemente.
   */
  function aoUploadQrConcluido(urlPublica: string) {
    if (!inicial?.id) {
      // Forma ainda não existe: guarda em memória; será persistido ao salvar.
      setPixQrUrl(urlPublica);
      return;
    }
    startSalvarQr(async () => {
      // URL vazia = remoção do QR (upload de novo arquivo ou clique em remover).
      const urlParaSalvar = urlPublica || undefined;
      const resultado = await onSalvarQr(inicial.id, urlParaSalvar);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      setPixQrUrl(urlPublica);
      router.refresh();
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

          {lojaId && (
            <>
              <Separator />
              <UploadQrPix
                lojaId={lojaId}
                urlAtual={pixQrUrl || null}
                onUploadConcluido={aoUploadQrConcluido}
                disabled={enviando || salvandoQr}
                onEnviar={onEnviarQr}
              />
              {salvandoQr && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Salvando QR...
                </p>
              )}
            </>
          )}
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

      <Button type="submit" className="w-full" disabled={enviando || salvandoQr}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Ativar"}
      </Button>
    </form>
  );
}
