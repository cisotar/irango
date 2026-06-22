"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  iniciarAssinatura,
  trocarPlano,
  atualizarMeioPagamentoAssinatura,
  cancelarAssinatura,
} from "@/lib/actions/assinatura";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

/**
 * Surface CLIENT das intenções de assinatura (issue 081). NÃO calcula valor:
 *   - Os planos (com `preco` AUTORITATIVO) chegam por props do servidor — exibidos,
 *     não editados.
 *   - O único dado enviado às actions é `plano_id`; o preço cobrado vem de
 *     `planos.preco` no servidor (RN-1). Schema `.strict()` rejeita valor injetado.
 *   - Atualizar pagamento devolve a URL do checkout HOSPEDADO do provider
 *     (dados de cartão nunca tocam o iRango, RN-11).
 *   - Cancelar NÃO é otimista: o status só muda quando o webhook confirmar.
 */

// Espelho do shape de `planos` necessário à UI. Server passa só estes campos.
export type PlanoView = {
  id: string;
  nome: string;
  preco: number;
  intervalo: string;
};

export type GerenciarAssinaturaClientProps = {
  planos: PlanoView[];
  /** id do plano atual da loja (ou null se nunca assinou). */
  planoAtualId: string | null;
  /** Há assinatura em vigor? (define assinar vs. trocar / mostra cancelar). */
  temAssinatura: boolean;
};

export function GerenciarAssinaturaClient({
  planos,
  planoAtualId,
  temAssinatura,
}: GerenciarAssinaturaClientProps) {
  const router = useRouter();
  const [selecionado, setSelecionado] = useState<string>(
    planoAtualId ?? planos[0]?.id ?? "",
  );
  const [enviandoPlano, startPlano] = useTransition();
  const [enviandoPagamento, startPagamento] = useTransition();
  const [cancelando, startCancelar] = useTransition();
  const [dialogCancelar, setDialogCancelar] = useState(false);

  if (planos.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Planos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhum plano disponível no momento. Tente novamente mais tarde.
          </p>
        </CardContent>
      </Card>
    );
  }

  const planoMudou = selecionado !== planoAtualId;

  function confirmarPlano() {
    if (!selecionado) return;
    const acao = temAssinatura ? trocarPlano : iniciarAssinatura;
    const sucesso = temAssinatura
      ? "Plano atualizado! A mudança será confirmada pelo provedor."
      : "Assinatura iniciada! Conclua o pagamento para ativar.";

    startPlano(async () => {
      const resultado = await acao({ plano_id: selecionado });
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      // `iniciarAssinatura`/`trocarPlano` retornam { ok: true } (sem url).
      if ("url" in resultado && resultado.url) {
        window.location.assign(resultado.url);
        return;
      }
      toast.success(sucesso);
      router.refresh();
    });
  }

  function atualizarPagamento() {
    startPagamento(async () => {
      const resultado = await atualizarMeioPagamentoAssinatura();
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      if ("url" in resultado && resultado.url) {
        window.location.assign(resultado.url);
        return;
      }
      // Sem URL: nada a fazer — informa e atualiza.
      toast.success("Pagamento atualizado.");
      router.refresh();
    });
  }

  function confirmarCancelamento() {
    startCancelar(async () => {
      const resultado = await cancelarAssinatura();
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success(
        "Cancelamento solicitado. Sua loja segue no ar até o fim do período pago.",
      );
      setDialogCancelar(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{temAssinatura ? "Trocar plano" : "Escolha seu plano"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioGroup
          value={selecionado}
          onValueChange={(v) => setSelecionado(String(v))}
          aria-label="Planos disponíveis"
        >
          {planos.map((p) => {
            const atual = p.id === planoAtualId;
            const ativo = p.id === selecionado;
            return (
              <label
                key={p.id}
                htmlFor={`plano-${p.id}`}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                  ativo
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <RadioGroupItem id={`plano-${p.id}`} value={p.id} />
                <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">
                    {p.nome}
                    {atual && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (plano atual)
                      </span>
                    )}
                  </span>
                  {/* Preço do servidor — somente exibido, nunca editável. */}
                  <span className="text-sm text-foreground">
                    <span className="font-semibold">
                      {formatarMoeda(p.preco)}
                    </span>{" "}
                    <span className="text-muted-foreground">/ {p.intervalo}</span>
                  </span>
                </div>
              </label>
            );
          })}
        </RadioGroup>

        <Button
          type="button"
          className="w-full"
          onClick={confirmarPlano}
          disabled={
            enviandoPlano || !selecionado || (temAssinatura && !planoMudou)
          }
        >
          {enviandoPlano && <Loader2 className="size-4 animate-spin" />}
          {temAssinatura
            ? planoMudou
              ? "Confirmar troca de plano"
              : "Este já é o seu plano"
            : "Assinar"}
        </Button>

        {temAssinatura && (
          <>
            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={atualizarPagamento}
                disabled={enviandoPagamento}
              >
                {enviandoPagamento ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CreditCard className="size-4" aria-hidden="true" />
                )}
                Atualizar forma de pagamento
              </Button>

              <Dialog open={dialogCancelar} onOpenChange={setDialogCancelar}>
                <DialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="destructive"
                      className="flex-1"
                    />
                  }
                >
                  Cancelar assinatura
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancelar assinatura?</DialogTitle>
                    <DialogDescription>
                      Sua loja continua no ar até o fim do período já pago.
                      Depois disso, ela ficará indisponível para os clientes até
                      você assinar de novo. Esta ação solicita o cancelamento ao
                      provedor de pagamento.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="flex-row justify-end gap-2">
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      Manter assinatura
                    </DialogClose>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={cancelando}
                      onClick={confirmarCancelamento}
                    >
                      {cancelando && <Loader2 className="size-4 animate-spin" />}
                      Sim, cancelar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
