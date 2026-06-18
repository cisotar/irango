"use client";

// Etapa 1 do wizard (issue 076): revisão dos itens + cupom.
//
// Itens vêm do useCarrinho (sessionStorage). Alterar quantidade reflete no
// preview imediatamente. Cupom é validado via Server Action validarCupomAction
// (073), que retorna só { valido, desconto_preview, mensagem } — o cliente
// nunca decide o desconto. Preview é UX; o servidor recalcula tudo (071).

import { useState, useTransition } from "react";
import Image from "next/image";
import { Check, Loader2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import { validarCupomAction } from "@/lib/actions/cupomPreview";
import type { ItemCarrinho } from "@/types/dominio";
import { linhaCarrinhoId } from "@/hooks/useCarrinho";
import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { ResumoValores } from "./ResumoValores";

const SECAO =
  "overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]";
const SECAO_TITULO =
  "border-b border-cinza-medio bg-cinza-claro px-4 py-3.5 text-[0.78rem] font-bold uppercase tracking-[1px] text-texto-muted";

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
    <div className="space-y-3">
      {/* Seção: Itens */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Itens do pedido</h2>
        <div className="divide-y divide-cinza-medio">
          {itens.map((item) => {
            const linhaId = linhaCarrinhoId(item.produtoId, item.opcionais);
            const opcionais =
              item.opcionais?.filter((o) => o.quantidade > 0) ?? [];
            // PREVIEW (seguranca.md §10): subtotal da linha COM opcionais via
            // calcularSubtotal (082). O servidor recalcula tudo do banco.
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
              <div key={linhaId} className="flex items-center gap-3 px-4 py-3.5">
                <div className="size-[52px] shrink-0 overflow-hidden rounded-[10px] bg-gradient-to-br from-[#e8dcc4] to-[#d8c4a0]">
                  {item.fotoUrl ? (
                    <Image
                      src={item.fotoUrl}
                      alt=""
                      width={52}
                      height={52}
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.88rem] font-bold text-texto">
                    {item.nome}
                  </p>
                  <p className="text-[0.75rem] text-texto-muted">
                    {formatarMoeda(item.preco)} / unidade
                  </p>
                  <ListaOpcionaisItem
                    opcionais={opcionais.map((o) => ({
                      id: o.opcionalId,
                      nome: o.nome,
                      preco: o.preco,
                      quantidade: o.quantidade,
                    }))}
                  />
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span
                    className="text-[0.92rem] font-black text-[var(--cor-destaque)]"
                    aria-label={`Preço total deste item: ${formatarMoeda(subtotalItem)}`}
                  >
                    {formatarMoeda(subtotalItem)}
                  </span>
                  <div
                    className="flex items-center"
                    role="group"
                    aria-label={`Quantidade de ${item.nome}`}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 rounded-r-none border-borda-nav bg-cinza-claro text-destructive hover:border-[var(--cor-destaque)] hover:bg-cinza-medio"
                      aria-label={`Diminuir ${item.nome}`}
                      onClick={() => onDecrementar(linhaId)}
                    >
                      <Minus className="size-3.5" aria-hidden />
                    </Button>
                    <div
                      className="flex size-8 items-center justify-center border-y border-borda-nav bg-white text-sm font-bold tabular-nums"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {item.quantidade}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 rounded-l-none border-borda-nav bg-cinza-claro hover:border-[var(--cor-destaque)] hover:bg-cinza-medio"
                      aria-label={`Aumentar ${item.nome}`}
                      onClick={() => onIncrementar(linhaId)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Seção: Cupom */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Cupom de desconto</h2>
        <div className="space-y-2 p-4">
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
          {mensagemCupom != null &&
            (cupomValido ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-lg border border-green-300 bg-[#dcfce7] px-3 py-2.5 text-xs font-semibold text-[#166534]"
              >
                <Check className="size-4 shrink-0" aria-hidden />
                <span>{mensagemCupom}</span>
              </div>
            ) : (
              <p className="text-xs text-destructive" role="alert">
                {mensagemCupom}
              </p>
            ))}
        </div>
      </div>

      {/* Seção: Resumo */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Resumo</h2>
        <div className="p-4">
          <ResumoValores
            subtotal={subtotal}
            desconto={desconto}
            frete={0}
            total={totalPreview}
            mostrarFrete={false}
          />
        </div>
      </div>

      <Button
        type="button"
        size="lg"
        className="h-14 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-black uppercase tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:bg-[var(--cor-destaque)]/90"
        disabled={itens.length === 0}
        onClick={onContinuar}
      >
        Continuar
      </Button>
    </div>
  );
}
