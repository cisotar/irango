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
import { Switch } from "@/components/ui/switch";
import { FormZona } from "@/components/painel/FormZona";
import { alternarZonaAtiva, removerZona } from "@/lib/actions/entrega";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";

export type EntregasClientProps = {
  zonas: ZonaVitrine[];
};

const ROTULO_TIPO: Record<string, string> = {
  bairro: "Por bairro",
  raio_km: "Por raio (km)",
  faixa_cep: "Por faixa de CEP",
};

export function EntregasClient({ zonas }: EntregasClientProps) {
  const router = useRouter();

  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<ZonaVitrine | null>(null);

  const [aRemover, setARemover] = useState<ZonaVitrine | null>(null);
  const [removendo, startRemocao] = useTransition();
  const [alternando, startAlternancia] = useTransition();

  function abrirCriar() {
    setEmEdicao(null);
    setFormAberto(true);
  }

  function abrirEditar(z: ZonaVitrine) {
    setEmEdicao(z);
    setFormAberto(true);
  }

  function aoSalvar() {
    setFormAberto(false);
    setEmEdicao(null);
    router.refresh();
  }

  function alternar(z: ZonaVitrine, ativo: boolean) {
    startAlternancia(async () => {
      const resultado = await alternarZonaAtiva(z.id, ativo);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      router.refresh();
    });
  }

  function confirmarRemocao() {
    if (!aRemover) return;
    const id = aRemover.id;
    startRemocao(async () => {
      const resultado = await removerZona(id);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Zona removida.");
      setARemover(null);
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Zonas de entrega
        </h1>
        <Button onClick={abrirCriar}>
          <Plus className="size-4" />
          Nova zona
        </Button>
      </div>

      {zonas.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma zona ainda. Crie a primeira com &ldquo;Nova zona&rdquo;.
          </CardContent>
        </Card>
      )}

      {zonas.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-foreground/10 p-0">
            {zonas.map((z) => (
              <div key={z.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {z.nome}
                    </span>
                    <Badge variant="secondary">
                      {ROTULO_TIPO[z.tipo] ?? z.tipo}
                    </Badge>
                    <Badge variant={z.ativo ? "secondary" : "outline"}>
                      {z.ativo ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {z.taxa
                      ? `Taxa ${formatarMoeda(z.taxa.taxa)}`
                      : "Sem taxa configurada"}
                    {z.taxa?.pedido_minimo_gratis != null
                      ? ` · grátis acima de ${formatarMoeda(z.taxa.pedido_minimo_gratis)}`
                      : ""}
                    {z.bairros.length > 0
                      ? ` · ${z.bairros.length} bairro(s)`
                      : ""}
                  </span>
                </div>

                <Switch
                  checked={z.ativo}
                  disabled={alternando}
                  onCheckedChange={(v) => alternar(z, v === true)}
                  aria-label={`${z.ativo ? "Desativar" : "Ativar"} ${z.nome}`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Editar ${z.nome}`}
                  onClick={() => abrirEditar(z)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover ${z.nome}`}
                  onClick={() => setARemover(z)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Sheet open={formAberto} onOpenChange={setFormAberto}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{emEdicao ? "Editar zona" : "Nova zona"}</SheetTitle>
            <SheetDescription>
              Defina a região atendida, a taxa de entrega e os bairros.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormZona
              key={emEdicao?.id ?? "novo"}
              onSucesso={aoSalvar}
              inicial={
                emEdicao
                  ? {
                      id: emEdicao.id,
                      nome: emEdicao.nome,
                      tipo: emEdicao.tipo,
                      ativo: emEdicao.ativo,
                      taxa: emEdicao.taxa?.taxa ?? null,
                      pedido_minimo_gratis:
                        emEdicao.taxa?.pedido_minimo_gratis ?? null,
                      raio_max_km: emEdicao.taxa?.raio_max_km ?? null,
                      bairros: emEdicao.bairros.map((b) => b.nome),
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
              Remover zona
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
              Tem certeza que deseja remover
              {aRemover ? ` "${aRemover.nome}"` : ""}? Esta ação não pode ser
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
