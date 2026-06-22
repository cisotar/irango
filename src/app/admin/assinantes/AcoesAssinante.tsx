"use client";

import { useState, useTransition, type ReactElement } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { AssinanteLinha } from "@/lib/supabase/queries/adminAssinatura";
import {
  concederCortesia,
  revogarCortesia,
  suspenderLoja,
  reativarLoja,
  excluirLoja,
} from "./actions";

type Resultado = { ok: true } | { ok: false; erro: string };

type AcoesAssinanteProps = {
  assinante: AssinanteLinha;
};

/**
 * Ações admin por loja (issue 082). NENHUM valor de billing é decidido aqui — o
 * cliente só envia `lojaId`; status/datas são constantes server-side nas actions
 * (RN-12/13/14). Precedência de UI (RN-15) evita ações incoerentes:
 *   - cortesia  → toggle ON; botão Suspender NÃO aparece (revogar a cortesia primeiro);
 *   - suspensa  → toggle DESABILITADO; só Reativar;
 *   - demais    → toggle OFF + Suspender disponível.
 * O servidor é a autoridade final — a UI só esconde o que seria contraditório.
 */
export function AcoesAssinante({
  assinante,
}: AcoesAssinanteProps): ReactElement {
  const { id, nome, status } = assinante;
  const [pendente, iniciar] = useTransition();
  const [confirmarSuspensao, setConfirmarSuspensao] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [textoConfirmacao, setTextoConfirmacao] = useState("");

  const ehCortesia = status === "cortesia";
  const ehSuspensa = status === "suspensa";

  // Gate anti-erro no cliente (RN-2): nunca é a barreira de autorização — o
  // servidor recebe só `lojaId` e valida via verificarAdminSaaS(). trim SIM
  // (espaço acidental ao colar não trava), case-sensitive (a fricção é o ponto).
  const exclusaoHabilitada = textoConfirmacao.trim() === nome.trim();

  function executar(
    acao: (lojaId: string) => Promise<Resultado>,
    sucesso: string,
  ): void {
    iniciar(async () => {
      try {
        const r = await acao(id);
        if (r.ok) {
          toast.success(sucesso);
        } else {
          toast.error(r.erro);
        }
      } catch {
        // Falha de admin propaga como exceção (D-4): não vira `{ ok:false }`.
        toast.error("Não foi possível concluir a ação.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {/* Toggle de cortesia — desabilitado em loja suspensa (RN-15) */}
      <div className="flex items-center gap-2">
        <Switch
          id={`cortesia-${id}`}
          checked={ehCortesia}
          disabled={pendente || ehSuspensa}
          onCheckedChange={(ativo) =>
            ativo
              ? executar(concederCortesia, `Cortesia concedida a "${nome}".`)
              : executar(revogarCortesia, `Cortesia revogada de "${nome}".`)
          }
        />
        <Label
          htmlFor={`cortesia-${id}`}
          className="cursor-pointer text-xs text-muted-foreground"
        >
          Cortesia
        </Label>
      </div>

      {/* Suspender NÃO aparece em loja cortesia (RN-15). Suspensa → só Reativar. */}
      {ehSuspensa ? (
        <Button
          size="sm"
          disabled={pendente}
          onClick={() => executar(reativarLoja, `"${nome}" reativada.`)}
        >
          {pendente && <Loader2 className="animate-spin" aria-hidden />}
          Reativar
        </Button>
      ) : ehCortesia ? null : (
        <Button
          variant="destructive"
          size="sm"
          disabled={pendente}
          onClick={() => setConfirmarSuspensao(true)}
        >
          Suspender
        </Button>
      )}

      <AlertDialog.Root
        open={confirmarSuspensao}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmarSuspensao(false);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg transition-all data-ending-style:opacity-0 data-starting-style:opacity-0">
            <AlertDialog.Title className="font-heading text-base font-medium text-foreground">
              Suspender loja
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
              {`A loja "${nome}" sai do ar imediatamente e o período vigente é encerrado agora, sem carência. Você pode reativá-la depois.`}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={<Button variant="outline" disabled={pendente} />}
              >
                Cancelar
              </AlertDialog.Close>
              <Button
                variant="destructive"
                disabled={pendente}
                onClick={() => {
                  setConfirmarSuspensao(false);
                  executar(suspenderLoja, `"${nome}" suspensa.`);
                }}
              >
                {pendente && <Loader2 className="animate-spin" aria-hidden />}
                Suspender
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* Zona de perigo — terminal, separada das ações reversíveis de billing.
          Sempre visível (qualquer status); posicionada por último à direita. */}
      <Separator orientation="vertical" className="h-5 max-sm:hidden" />
      <Button
        variant="destructive"
        size="sm"
        disabled={pendente}
        onClick={() => setConfirmarExclusao(true)}
      >
        Excluir loja
      </Button>

      <AlertDialog.Root
        open={confirmarExclusao}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setConfirmarExclusao(false);
            setTextoConfirmacao("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg transition-all data-ending-style:opacity-0 data-starting-style:opacity-0">
            <AlertDialog.Title className="font-heading text-base font-medium text-foreground">
              Excluir loja definitivamente
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-destructive">
                Esta ação é IRREVERSÍVEL.
              </span>{" "}
              {`Ao excluir "${nome}", são apagados permanentemente:`}
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                <li>a loja e suas configurações</li>
                <li>todos os produtos do catálogo</li>
                <li>todos os pedidos e seu histórico</li>
                <li>todas as faturas</li>
                <li>todas as fotos enviadas</li>
              </ul>
              <span className="mt-2 block font-medium text-destructive">
                Não há como desfazer nem recuperar.
              </span>
            </AlertDialog.Description>

            <div className="mt-4">
              <Label
                htmlFor={`confirma-exclusao-${id}`}
                className="text-sm font-medium"
              >
                Para confirmar, digite o nome da loja:
              </Label>
              <Input
                id={`confirma-exclusao-${id}`}
                autoFocus
                disabled={pendente}
                placeholder={nome}
                value={textoConfirmacao}
                onChange={(e) => setTextoConfirmacao(e.target.value)}
                aria-describedby={`hint-exclusao-${id}`}
                className="mt-1.5"
              />
              <p
                id={`hint-exclusao-${id}`}
                className="mt-1 text-xs text-muted-foreground"
              >
                O nome deve bater exatamente.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={<Button variant="outline" disabled={pendente} />}
              >
                Cancelar
              </AlertDialog.Close>
              <Button
                variant="destructive"
                className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                disabled={!exclusaoHabilitada || pendente}
                onClick={() => {
                  setConfirmarExclusao(false);
                  setTextoConfirmacao("");
                  executar(excluirLoja, `Loja "${nome}" excluída permanentemente.`);
                }}
              >
                {pendente && <Loader2 className="animate-spin" aria-hidden />}
                Excluir definitivamente
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
