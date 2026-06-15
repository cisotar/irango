"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useCarrinho, linhaCarrinhoId } from "@/hooks/useCarrinho";
import { validarCupom } from "@/lib/actions/cupom";
import { calcularTotal, calcularSubtotal } from "@/lib/utils/calcularTotal";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { FormEndereco, type EnderecoEntrega } from "./FormEndereco";

export type ZonaEntrega = { id: string; nome: string; taxa_entrega: number };
export type FormaPagamento = {
  id: string;
  tipo: string;
  instrucoes?: string | null;
};

export type CarrinhoProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lojaId: string;
  lojaSlug: string;
  zonas: ZonaEntrega[];
  formasPagamento: FormaPagamento[];
};

/** Veredito do cupom — sempre PREVIEW (servidor reconfirma no checkout). */
type EstadoCupom =
  | { status: "idle" }
  | { status: "validando" }
  | { status: "valido"; codigo: string; desconto: number }
  | { status: "invalido" };

/** Estado persistido para o checkout — SEM valores monetários (seguranca.md §10). */
type EstadoCheckout = {
  // Só id + quantidade por item e por opcional — nenhum preço (seguranca.md §10).
  itens: {
    produtoId: string;
    quantidade: number;
    opcionais?: { opcionalId: string; quantidade: number }[];
  }[];
  zonaId: string | null;
  formaPagamentoId: string | null;
  endereco: EnderecoEntrega | null;
  codigoCupom: string | null;
};

const CHAVE_CHECKOUT = "irango:checkout";

export function Carrinho({
  open,
  onOpenChange,
  lojaId,
  lojaSlug,
  zonas,
  formasPagamento,
}: CarrinhoProps) {
  const router = useRouter();
  const { itens, subtotal, incrementar, decrementar, remover } = useCarrinho();

  const [codigoCupom, setCodigoCupom] = useState("");
  const [cupom, setCupom] = useState<EstadoCupom>({ status: "idle" });
  const [zonaId, setZonaId] = useState<string | null>(zonas[0]?.id ?? null);
  const [formaPagamentoId, setFormaPagamentoId] = useState<string | null>(
    formasPagamento[0]?.id ?? null,
  );
  const [endereco, setEndereco] = useState<EnderecoEntrega | null>(null);
  const [enviando, startEnvio] = useTransition();

  const zonaSelecionada = useMemo(
    () => zonas.find((z) => z.id === zonaId) ?? null,
    [zonas, zonaId],
  );

  // Frete preview = taxa da zona escolhida (issue 029 §4). 0 se nenhuma escolhida.
  const taxaEntrega = zonaSelecionada?.taxa_entrega ?? 0;
  const descontoCupom = cupom.status === "valido" ? cupom.desconto : 0;

  // Total PREVIEW — recalculado no servidor no checkout (calcularTotal é pura).
  const { total } = useMemo(
    () =>
      calcularTotal({
        subtotal,
        desconto: descontoCupom,
        taxaEntrega,
      }),
    [subtotal, descontoCupom, taxaEntrega],
  );

  const aplicarCupom = useCallback(() => {
    const codigo = codigoCupom.trim();
    if (codigo.length === 0) return;
    setCupom({ status: "validando" });
    startEnvio(async () => {
      const resultado = await validarCupom({ lojaId, codigo, subtotal });
      if (resultado.valido) {
        setCupom({ status: "valido", codigo, desconto: resultado.desconto });
      } else {
        setCupom({ status: "invalido" });
      }
    });
  }, [codigoCupom, lojaId, subtotal]);

  const finalizar = useCallback(() => {
    const estado: EstadoCheckout = {
      // Só ids + quantidades — nenhum valor monetário (seguranca.md §10). Os
      // opcionais escolhidos seguem para o checkout (preço recalculado lá).
      itens: itens.map((i) => ({
        produtoId: i.produtoId,
        quantidade: i.quantidade,
        ...(i.opcionais && i.opcionais.length > 0
          ? {
              opcionais: i.opcionais.map((o) => ({
                opcionalId: o.opcionalId,
                quantidade: o.quantidade,
              })),
            }
          : {}),
      })),
      zonaId,
      formaPagamentoId,
      endereco,
      codigoCupom: cupom.status === "valido" ? cupom.codigo : null,
    };
    try {
      window.sessionStorage.setItem(CHAVE_CHECKOUT, JSON.stringify(estado));
    } catch {
      // Storage indisponível — o checkout relê o carrinho; não trava o fluxo.
    }
    startEnvio(() => {
      router.push(`/loja/${lojaSlug}/pedido`);
    });
  }, [itens, zonaId, formaPagamentoId, endereco, cupom, lojaSlug, router]);

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
                  // PREVIEW (§10): preço da linha COM opcionais via calcularSubtotal (082).
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

              <Separator />

              {/* Cupom */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="carrinho-cupom"
                  className="text-sm font-medium"
                >
                  Cupom de desconto
                </label>
                <div className="flex gap-2">
                  <Input
                    id="carrinho-cupom"
                    value={codigoCupom}
                    onChange={(e) => setCodigoCupom(e.target.value)}
                    placeholder="PAOCISO10"
                    aria-invalid={cupom.status === "invalido"}
                    aria-describedby={
                      cupom.status === "invalido"
                        ? "carrinho-cupom-erro"
                        : cupom.status === "valido"
                          ? "carrinho-cupom-ok"
                          : undefined
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 shrink-0"
                    disabled={cupom.status === "validando"}
                    onClick={aplicarCupom}
                  >
                    {cupom.status === "validando" ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : null}
                    Aplicar
                  </Button>
                </div>
                {cupom.status === "valido" && (
                  <p
                    id="carrinho-cupom-ok"
                    className="text-xs text-[var(--cor-destaque)]"
                  >
                    ✓ Cupom {cupom.codigo} aplicado (
                    {formatarMoeda(cupom.desconto)} de desconto)
                  </p>
                )}
                {cupom.status === "invalido" && (
                  <p
                    id="carrinho-cupom-erro"
                    className="text-xs text-destructive"
                  >
                    ⚠ Cupom inválido ou expirado.
                  </p>
                )}
              </div>

              <Separator />

              {/* Zona de entrega */}
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Entregar em</legend>
                {zonas.map((zona) => (
                  <label
                    key={zona.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="carrinho-zona"
                      value={zona.id}
                      checked={zonaId === zona.id}
                      onChange={() => setZonaId(zona.id)}
                    />
                    <span>
                      {zona.nome} — {formatarMoeda(zona.taxa_entrega)}
                    </span>
                  </label>
                ))}
              </fieldset>

              <Separator />

              {/* Forma de pagamento */}
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">
                  Forma de pagamento
                </legend>
                {formasPagamento.map((forma) => (
                  <label
                    key={forma.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="carrinho-pagamento"
                      value={forma.id}
                      checked={formaPagamentoId === forma.id}
                      onChange={() => setFormaPagamentoId(forma.id)}
                    />
                    <span>{forma.tipo}</span>
                  </label>
                ))}
              </fieldset>

              <Separator />

              <FormEndereco onEnderecoChange={setEndereco} />
            </div>

            <SheetFooter>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Valores estimados — total final confirmado no servidor.
              </p>

              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>{formatarMoeda(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Frete{zonaSelecionada ? ` (${zonaSelecionada.nome})` : ""}</dt>
                  <dd>{formatarMoeda(taxaEntrega)}</dd>
                </div>
                {descontoCupom > 0 && cupom.status === "valido" && (
                  <div className="flex justify-between text-[var(--cor-destaque)]">
                    <dt>Desconto ({cupom.codigo})</dt>
                    <dd>− {formatarMoeda(descontoCupom)}</dd>
                  </div>
                )}
                <Separator className="my-1" />
                <div className="flex justify-between text-lg font-bold">
                  <dt>Total estimado</dt>
                  <dd>{formatarMoeda(total)}</dd>
                </div>
              </dl>

              <Button
                className="min-h-11 bg-[var(--cor-primaria)] text-white hover:bg-[var(--cor-primaria)]/90"
                disabled={enviando}
                onClick={finalizar}
              >
                {enviando ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Finalizando…
                  </>
                ) : (
                  "Finalizar pedido"
                )}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
