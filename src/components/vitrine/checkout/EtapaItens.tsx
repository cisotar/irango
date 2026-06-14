"use client";

// Etapa 1 do wizard (issue 076): revisão dos itens + cupom.
//
// Itens vêm do useCarrinho (sessionStorage). Alterar quantidade reflete no
// preview imediatamente. Cupom é validado via Server Action validarCupomAction
// (073), que retorna só { valido, desconto_preview, mensagem } — o cliente
// nunca decide o desconto. Preview é UX; o servidor recalcula tudo (071).

import { useState, useTransition } from "react";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { validarCupomAction } from "@/lib/actions/cupomPreview";
import type { ItemCarrinho } from "@/types/dominio";
import { linhaCarrinhoId } from "@/hooks/useCarrinho";
import { ResumoValores } from "./ResumoValores";

export type EtapaItensProps = {
  lojaId: string;
  itens: ItemCarrinho[];
  subtotal: number;
  desconto: number;
  codigoCupom: string | null;
  /** id = linhaCarrinhoId(produtoId, opcionais) — distingue linhas com opcionais diferentes. */
  onIncrementar: (linhaId: string) => void;
  onDecrementar: (linhaId: string) => void;
  onRemover: (linhaId: string) => void;
  /** Aplica/remove cupom: código + desconto preview confirmados pelo servidor. */
  onAplicarCupom: (codigo: string, descontoPreview: number) => void;
  onRemoverCupom: () => void;
  onContinuar: () => void;
};

export function EtapaItens({
  lojaId,
  itens,
  subtotal,
  desconto,
  codigoCupom,
  onIncrementar,
  onDecrementar,
  onRemover,
  onAplicarCupom,
  onRemoverCupom,
  onContinuar,
}: EtapaItensProps) {
  const [codigo, setCodigo] = useState(codigoCupom ?? "");
  const [mensagemCupom, setMensagemCupom] = useState<string | null>(null);
  const [cupomValido, setCupomValido] = useState(codigoCupom != null);
  const [validando, startValidacao] = useTransition();

  const totalPreview = Math.max(0, subtotal - desconto);

  function aplicarCupom() {
    const cod = codigo.trim();
    if (cod.length === 0) {
      setMensagemCupom("Digite um código de cupom.");
      setCupomValido(false);
      return;
    }
    startValidacao(async () => {
      const r = await validarCupomAction(lojaId, cod, subtotal);
      setMensagemCupom(r.mensagem);
      setCupomValido(r.valido);
      if (r.valido) {
        onAplicarCupom(cod.toUpperCase(), r.desconto_preview);
      } else {
        onRemoverCupom();
      }
    });
  }

  function removerCupom() {
    setCodigo("");
    setMensagemCupom(null);
    setCupomValido(false);
    onRemoverCupom();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-semibold text-foreground">
            Itens do pedido
          </h2>
          {itens.map((item) => {
            const linhaId = linhaCarrinhoId(item.produtoId, item.opcionais);
            return (
            <div key={linhaId} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatarMoeda(item.preco)} cada
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label={`Diminuir ${item.nome}`}
                  onClick={() => onDecrementar(linhaId)}
                >
                  <Minus className="size-3.5" aria-hidden />
                </Button>
                <span className="w-6 text-center text-sm font-medium tabular-nums">
                  {item.quantidade}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label={`Aumentar ${item.nome}`}
                  onClick={() => onIncrementar(linhaId)}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </div>

              <span className="w-20 text-right text-sm font-semibold text-primary">
                {formatarMoeda(item.preco * item.quantidade)}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Remover ${item.nome}`}
                onClick={() => onRemover(linhaId)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <h2 className="text-sm font-semibold text-foreground">
            Cupom de desconto
          </h2>
          <div className="flex gap-2">
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ex.: PROMO10"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Código do cupom"
              disabled={validando || cupomValido}
            />
            {cupomValido ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={removerCupom}
              >
                Remover
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={aplicarCupom}
                disabled={validando}
              >
                {validando && <Loader2 className="mr-1 size-4 animate-spin" />}
                Aplicar
              </Button>
            )}
          </div>
          {mensagemCupom != null && (
            <p
              className={[
                "text-xs",
                cupomValido ? "text-green-700" : "text-destructive",
              ].join(" ")}
            >
              {mensagemCupom}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <ResumoValores
            subtotal={subtotal}
            desconto={desconto}
            frete={0}
            total={totalPreview}
            mostrarFrete={false}
          />
        </CardContent>
      </Card>

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={itens.length === 0}
        onClick={onContinuar}
      >
        Continuar
      </Button>
    </div>
  );
}
