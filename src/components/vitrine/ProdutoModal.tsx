"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Minus, Plus, X } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

/** Produto exibido no modal — subconjunto do modelo `produtos` (sem opcionais). */
export type ProdutoModalDados = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  fotoUrl: string | null;
  /** false → selo "Esgotado" + CTA desabilitado. Default true. */
  disponivel?: boolean;
};

type ProdutoModalProps = {
  produto: ProdutoModalDados | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Confirma a adição ao carrinho. Quem chama soma a quantidade no useCarrinho. */
  onAdicionar: (produtoId: string, quantidade: number) => void;
};

/** Só `https:` vira imagem remota — anti-XSS (seguranca.md §15). */
function fotoSegura(url: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/**
 * Modal/bottom-sheet de detalhe do produto na vitrine
 * (design-claude/vitrine/produto-modal.html). Sem opcionais e sem observação por
 * item — ambos fora do modelo de dados atual / nível-pedido.
 *
 * Preço unitário e subtotal aqui são PREVIEW de UX — o servidor recalcula tudo a
 * partir do banco no checkout (seguranca.md §10). Nenhum valor monetário daqui é
 * autoritativo: o carrinho só carrega produtoId + quantidade até o checkout.
 */
export function ProdutoModal({
  produto,
  open,
  onOpenChange,
  onAdicionar,
}: ProdutoModalProps) {
  const [quantidade, setQuantidade] = useState(1);

  // Reseta para 1 sempre que o modal abre (ou troca de produto).
  useEffect(() => {
    if (open) setQuantidade(1);
  }, [open, produto?.id]);

  if (!produto) return null;

  const disponivel = produto.disponivel ?? true;
  const foto = fotoSegura(produto.fotoUrl);
  const subtotal = produto.preco * quantidade; // preview — servidor recalcula

  const confirmar = () => {
    if (!disponivel) return;
    onAdicionar(produto.id, quantidade);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Bottom-sheet: sobe de baixo, cantos arredondados no topo, scroll interno.
        className="gap-0 rounded-t-[20px] border-0 p-0 sm:mx-auto sm:max-w-[480px] [&>button.absolute]:hidden"
      >
        {/* Hero — cor primária da loja, texto branco */}
        <div className="relative flex items-start gap-4 bg-[var(--cor-primaria)] p-4 pr-12">
          <div className="relative size-[110px] shrink-0 overflow-hidden rounded-xl border-2 border-white/30">
            {foto ? (
              <Image
                src={foto}
                alt={produto.nome}
                width={220}
                height={220}
                unoptimized
                className={`size-full object-cover ${
                  disponivel ? "" : "[filter:grayscale(0.7)_brightness(0.75)]"
                }`}
              />
            ) : (
              <div
                aria-hidden
                className="size-full bg-[linear-gradient(135deg,#4a3a22,#6b5131)]"
              />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SheetTitle className="text-base font-black leading-tight text-white">
              {produto.nome}
            </SheetTitle>
            {produto.descricao ? (
              <p className="text-sm leading-snug text-white/80">
                {produto.descricao}
              </p>
            ) : null}
            <p
              className={`mt-1 text-2xl font-black text-[#f5d78c] ${
                disponivel ? "" : "line-through opacity-60"
              }`}
            >
              {formatarMoeda(produto.preco)}
            </p>
            {!disponivel ? (
              <span
                role="status"
                className="mt-1 w-fit rounded-full border-[1.5px] border-white/40 bg-[#8B4513] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white"
              >
                ✕ Esgotado
              </span>
            ) : null}
          </div>

          <button
            type="button"
            aria-label="Fechar detalhes do produto"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white hover:bg-white/25"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Corpo — seção Quantidade */}
        <div className="border-b border-[#eeeeee] p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-marrom-cafe">
            Quantidade
          </p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p
                className={`text-sm text-[var(--texto)] ${disponivel ? "" : "opacity-50"}`}
              >
                Unidades
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {disponivel
                  ? `Cada unidade · ${formatarMoeda(produto.preco)}`
                  : "Produto indisponível no momento"}
              </p>
            </div>
            <div
              role="group"
              aria-label="Selecionar quantidade"
              aria-disabled={!disponivel}
              className={`flex items-center overflow-hidden rounded-[10px] border-[1.5px] border-[#dccbb0] bg-[#f9f9f9] ${
                disponivel ? "" : "pointer-events-none opacity-45"
              }`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Diminuir quantidade"
                disabled={!disponivel || quantidade <= 1}
                onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
                className="size-11 rounded-none text-[var(--cor-destaque)]"
              >
                <Minus aria-hidden />
              </Button>
              <span
                role="status"
                aria-live="polite"
                aria-label={`Quantidade: ${quantidade}`}
                className="min-w-9 border-x border-[#dccbb0] px-1 text-center text-base font-bold tabular-nums text-[var(--texto)]"
              >
                {quantidade}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Aumentar quantidade"
                disabled={!disponivel}
                onClick={() => setQuantidade((q) => q + 1)}
                className="size-11 rounded-none text-[var(--cor-destaque)]"
              >
                <Plus aria-hidden />
              </Button>
            </div>
          </div>
        </div>

        {/* Subtotal ao vivo (PREVIEW) */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className={`flex items-center justify-between bg-[#f9f9f9] px-4 py-3.5 ${
            disponivel ? "" : "opacity-45"
          }`}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Subtotal do item
          </span>
          <span className="text-lg font-black text-[var(--cor-destaque)]">
            {formatarMoeda(subtotal)}
          </span>
        </div>

        {/* Footer fixo — CTA */}
        <div className="flex flex-col gap-2 border-t border-[#eeeeee] p-4 pb-5">
          <Button
            type="button"
            onClick={confirmar}
            disabled={!disponivel}
            aria-label={
              disponivel
                ? `Adicionar ${quantidade} ${produto.nome} ao carrinho por ${formatarMoeda(subtotal)}`
                : "Produto esgotado — não é possível adicionar ao carrinho"
            }
            className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-xl bg-[var(--cor-destaque)] px-5 text-base font-black text-white hover:bg-[var(--cor-destaque)]/90 disabled:bg-[#9a9a9a]"
          >
            <span>{disponivel ? "Adicionar ao carrinho" : "Produto esgotado"}</span>
            <span className="rounded-lg bg-white/15 px-2.5 py-1 text-base font-black">
              {formatarMoeda(subtotal)}
            </span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
