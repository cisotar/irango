"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FormPagamento } from "@/components/painel/FormPagamento";
import {
  salvarFormaPagamento as salvarFormaPagamentoLojista,
  removerFormaPagamento as removerFormaPagamentoLojista,
  atualizarFormaPagamento as atualizarFormaPagamentoLojista,
  salvarQrPix as salvarQrPixLojista,
} from "@/lib/actions/pagamento";
import type { EnviarQrPix } from "@/components/painel/UploadQrPix";
import type { FormaPagamento } from "@/lib/supabase/queries/entregaPagamento";

export type PagamentosClientProps = {
  formas: FormaPagamento[];
  /** ID da loja (derivado do servidor) — repassado ao FormPagamento para o upload de QR Pix. */
  lojaId: string;
  /**
   * Actions injetáveis. Omitidas no painel do lojista (caem nos defaults). A via
   * admin passa as variantes escopadas por `lojaId`.
   */
  acoes?: {
    salvarFormaPagamento?: typeof salvarFormaPagamentoLojista;
    removerFormaPagamento?: typeof removerFormaPagamentoLojista;
    atualizarFormaPagamento?: typeof atualizarFormaPagamentoLojista;
    salvarQrPix?: typeof salvarQrPixLojista;
    enviarQrPix?: EnviarQrPix;
  };
};

type TipoPagamento = "pix" | "dinheiro" | "link" | "cartao";

const TIPOS: {
  tipo: TipoPagamento;
  rotulo: string;
  descricao: string;
  /** Tipos com config própria (pix/link) abrem o form ao ativar; null ativa direto. */
  configTipo: "pix" | "link" | null;
}[] = [
  {
    tipo: "pix",
    rotulo: "Pix",
    descricao: "Chave Pix exibida ao cliente no checkout.",
    configTipo: "pix",
  },
  {
    tipo: "dinheiro",
    rotulo: "Dinheiro na entrega",
    descricao: "Pagamento em espécie no momento da entrega.",
    configTipo: null,
  },
  {
    tipo: "link",
    rotulo: "Link de pagamento",
    descricao: "Link externo (gateway) para o cliente pagar.",
    configTipo: "link",
  },
  {
    tipo: "cartao",
    rotulo: "Cartão na entrega",
    descricao: "Maquininha no momento da entrega.",
    configTipo: null,
  },
];

export function PagamentosClient({
  formas,
  lojaId,
  acoes,
}: PagamentosClientProps) {
  const router = useRouter();

  const salvarFormaPagamento =
    acoes?.salvarFormaPagamento ?? salvarFormaPagamentoLojista;
  const removerFormaPagamento =
    acoes?.removerFormaPagamento ?? removerFormaPagamentoLojista;

  const [formAberto, setFormAberto] = useState(false);
  // Só tipos com config (pix/link) abrem o Sheet de configuração.
  const [tipoEmEdicao, setTipoEmEdicao] = useState<"pix" | "link" | null>(null);
  const [salvando, startSalvar] = useTransition();

  function formaDoTipo(tipo: TipoPagamento): FormaPagamento | undefined {
    return formas.find((f) => f.tipo === tipo);
  }

  function abrirConfig(tipo: "pix" | "link") {
    setTipoEmEdicao(tipo);
    setFormAberto(true);
  }

  function aoSalvar() {
    setFormAberto(false);
    setTipoEmEdicao(null);
    router.refresh();
  }

  function alternar(
    tipo: TipoPagamento,
    ativar: boolean,
    configTipo: "pix" | "link" | null,
  ) {
    const existente = formaDoTipo(tipo);

    if (ativar) {
      // Tipos com config abrem o form (chave Pix / URL). Simples ativam direto.
      if (configTipo) {
        abrirConfig(configTipo);
        return;
      }
      startSalvar(async () => {
        const resultado = await salvarFormaPagamento({ tipo, config: {} });
        if (!resultado.ok) {
          toast.error(resultado.erro);
          return;
        }
        toast.success("Forma de pagamento ativada.");
        router.refresh();
      });
      return;
    }

    // Desativar = remover (a tabela não tem coluna `ativo`).
    if (!existente) return;
    startSalvar(async () => {
      const resultado = await removerFormaPagamento(existente.id);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Forma de pagamento desativada.");
      router.refresh();
    });
  }

  const formaEmEdicao = tipoEmEdicao ? formaDoTipo(tipoEmEdicao) : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Formas de pagamento
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha como seus clientes podem pagar. O iRango não processa o
          pagamento — só exibe as instruções no checkout.
        </p>
      </div>

      <Card>
        <CardContent className="divide-y divide-foreground/10 p-0">
          {TIPOS.map(({ tipo, rotulo, descricao, configTipo }) => {
            const existente = formaDoTipo(tipo);
            const ativo = existente != null;
            return (
              <div key={tipo} className="flex items-center gap-3 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{rotulo}</span>
                    <Badge variant={ativo ? "secondary" : "outline"}>
                      {ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {descricao}
                  </span>
                </div>

                {ativo && configTipo && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Editar ${rotulo}`}
                    onClick={() => abrirConfig(configTipo)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                <Switch
                  checked={ativo}
                  disabled={salvando}
                  onCheckedChange={(v) => alternar(tipo, v === true, configTipo)}
                  aria-label={`${ativo ? "Desativar" : "Ativar"} ${rotulo}`}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Sheet open={formAberto} onOpenChange={setFormAberto}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {tipoEmEdicao === "pix" ? "Configurar Pix" : "Configurar link"}
            </SheetTitle>
            <SheetDescription>
              {tipoEmEdicao === "pix"
                ? "Informe a chave Pix que o cliente verá no checkout."
                : "Informe o link de pagamento (URL completa)."}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            {tipoEmEdicao && (
              <FormPagamento
                key={`${tipoEmEdicao}-${formaEmEdicao?.id ?? "novo"}`}
                tipo={tipoEmEdicao}
                lojaId={lojaId}
                onSucesso={aoSalvar}
                onSalvar={acoes?.salvarFormaPagamento}
                onAtualizar={acoes?.atualizarFormaPagamento}
                onSalvarQr={acoes?.salvarQrPix}
                onEnviarQr={acoes?.enviarQrPix}
                inicial={
                  formaEmEdicao
                    ? { id: formaEmEdicao.id, config: formaEmEdicao.config }
                    : undefined
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
