"use client";

import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCarrinho, linhaCarrinhoId } from "@/hooks/useCarrinho";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";

export type CarrinhoProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lojaSlug: string;
};

export function Carrinho({ open, onOpenChange, lojaSlug }: CarrinhoProps) {
  const router = useRouter();
  const { itens, subtotal, incrementar, decrementar, remover } = useCarrinho();

  const vazio = itens.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Seu pedido</SheetTitle>
        </SheetHeader>

        {vazio ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <ShoppingCart className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-medium">Seu carrinho está vazio</p>
            <p className="text-sm text-muted-foreground">
              Adicione itens da loja para começar.
            </p>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
            >
              Ver produtos
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <ul className="divide-y">
                {itens.map((item) => {
                  const linhaId = linhaCarrinhoId(item.produtoId, item.opcionais);
                  const opcionais =
                    item.opcionais?.filter((o) => o.quantidade > 0) ?? [];
                  const subtotalItem = calcularSubtotal([
                    {
                      preco: item.preco,
                      quantidade: item.quantidade,
                      opcionais: opcionais.map((o) => ({
                        preco: o.preco,
                        quantidade: o.quantidade,
                      })),
                    },
                  ]);
                  return (
                    <li key={linhaId} className="flex gap-3 py-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.fotoUrl ?? "/placeholder-produto.png"}
                        alt=""
                        className="size-12 shrink-0 rounded-md object-cover"
                      />
                      <div className="flex flex-1 flex-col gap-1">
                        <span className="text-sm font-medium">{item.nome}</span>
                        <span className="text-sm text-muted-foreground">
                          {formatarMoeda(subtotalItem)}
                        </span>
                        <ListaOpcionaisItem
                          opcionais={opcionais.map((o) => ({
                            id: o.opcionalId,
                            nome: o.nome,
                            preco: o.preco,
                            quantidade: o.quantidade,
                          }))}
                        />
                        <div className="mt-1 flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-11"
                            aria-label={`Diminuir ${item.nome}`}
                            onClick={() => decrementar(linhaId)}
                          >
                            <Minus aria-hidden />
                          </Button>
                          <span
                            className="w-8 text-center text-sm tabular-nums"
                            aria-label={`Quantidade de ${item.nome}`}
                          >
                            {item.quantidade}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-11"
                            aria-label={`Aumentar ${item.nome}`}
                            onClick={() => incrementar(linhaId)}
                          >
                            <Plus aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto size-11"
                            aria-label={`Remover ${item.nome}`}
                            onClick={() => remover(linhaId)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <SheetFooter>
              <Separator />
              <div className="flex justify-between text-sm font-semibold">
                <span>Subtotal</span>
                <span>{formatarMoeda(subtotal)}</span>
              </div>
              <Button
                className="min-h-11 bg-[var(--cor-primaria)] text-white hover:bg-[var(--cor-primaria)]/90"
                onClick={() => {
                  onOpenChange(false);
                  router.push(`/loja/${lojaSlug}/pedido`);
                }}
              >
                Finalizar pedido
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
