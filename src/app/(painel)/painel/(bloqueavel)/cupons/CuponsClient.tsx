"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FormCupom } from "@/components/painel/FormCupom";
import type { AcoesFormCupom } from "@/components/painel/FormCupom";
import { removerCupom } from "@/lib/actions/cupom";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { Cupom } from "@/lib/supabase/queries/entregaPagamento";

/**
 * Contrato de actions do `CuponsClient`: o do `FormCupom` (criar/atualizar)
 * estendido com `remover`, invocado diretamente pela listagem. Reusar
 * `AcoesFormCupom` mantém uma fonte única do contrato criar/atualizar.
 */
export type AcoesCuponsClient = AcoesFormCupom & {
  remover?: typeof removerCupom;
};

export type CuponsClientProps = {
  cupons: Cupom[];
  acoes?: AcoesCuponsClient;
};

/** Cupom expirado se tem data de expiração no passado. */
function estaExpirado(cupom: Cupom): boolean {
  return cupom.expira_em != null && new Date(cupom.expira_em).getTime() <= Date.now();
}

function rotuloValor(cupom: Cupom): string {
  return cupom.tipo === "percentual"
    ? `${cupom.valor}%`
    : formatarMoeda(cupom.valor);
}

function formatarData(iso: string | null): string {
  if (!iso) return "Sem validade";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function CuponsClient({ cupons, acoes }: CuponsClientProps) {
  const router = useRouter();

  // Fallback: sem `acoes`, usa a action do lojista (zero regressão no painel).
  const remover = acoes?.remover ?? removerCupom;

  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Cupom | null>(null);

  const [aRemover, setARemover] = useState<Cupom | null>(null);
  const [removendo, startRemocao] = useTransition();

  function abrirCriar() {
    setEmEdicao(null);
    setFormAberto(true);
  }

  function abrirEditar(c: Cupom) {
    setEmEdicao(c);
    setFormAberto(true);
  }

  function aoSalvar() {
    setFormAberto(false);
    setEmEdicao(null);
    router.refresh();
  }

  function confirmarRemocao() {
    if (!aRemover) return;
    const id = aRemover.id;
    startRemocao(async () => {
      const resultado = await remover(id);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Cupom removido.");
      setARemover(null);
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Cupons
        </h1>
        <Button onClick={abrirCriar}>
          <Plus className="size-4" />
          Novo cupom
        </Button>
      </div>

      {cupons.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum cupom ainda. Crie o primeiro com &ldquo;Novo cupom&rdquo;.
          </CardContent>
        </Card>
      )}

      {cupons.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-foreground/10 p-0">
            {cupons.map((c) => {
              const expirado = estaExpirado(c);
              const inativo = !c.ativo || expirado;
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono font-medium text-foreground">
                        {c.codigo}
                      </span>
                      <Badge variant="secondary">{rotuloValor(c)}</Badge>
                      <Badge variant={inativo ? "outline" : "secondary"}>
                        {expirado ? "Expirado" : c.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {c.usos_contagem}
                      {c.usos_maximos != null ? `/${c.usos_maximos}` : ""} usos ·{" "}
                      {formatarData(c.expira_em)}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Editar ${c.codigo}`}
                    onClick={() => abrirEditar(c)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remover ${c.codigo}`}
                    onClick={() => setARemover(c)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Sheet open={formAberto} onOpenChange={setFormAberto}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{emEdicao ? "Editar cupom" : "Novo cupom"}</SheetTitle>
            <SheetDescription>
              Configure o desconto, validade e limite de usos.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormCupom
              key={emEdicao?.id ?? "novo"}
              acoes={acoes}
              onSucesso={aoSalvar}
              inicial={
                emEdicao
                  ? {
                      id: emEdicao.id,
                      codigo: emEdicao.codigo,
                      tipo: emEdicao.tipo,
                      valor: emEdicao.valor,
                      pedido_minimo: emEdicao.pedido_minimo,
                      usos_maximos: emEdicao.usos_maximos,
                      expira_em: emEdicao.expira_em,
                      ativo: emEdicao.ativo,
                    }
                  : undefined
              }
            />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog.Root
        open={aRemover !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setARemover(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg transition-all data-ending-style:opacity-0 data-starting-style:opacity-0">
            <AlertDialog.Title className="font-heading text-base font-medium text-foreground">
              Remover cupom
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
              Tem certeza que deseja remover
              {aRemover ? ` "${aRemover.codigo}"` : ""}? Esta ação não pode ser
              desfeita.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={<Button variant="outline" disabled={removendo} />}
              >
                Cancelar
              </AlertDialog.Close>
              <Button
                variant="destructive"
                disabled={removendo}
                onClick={confirmarRemocao}
              >
                {removendo && <Loader2 className="mr-2 size-4 animate-spin" />}
                Remover
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
