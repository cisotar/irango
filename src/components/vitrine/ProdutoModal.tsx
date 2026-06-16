"use client";

import { useState } from "react";
import Image from "next/image";
import { Minus, Plus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type { OpcionalCarrinho } from "@/types/dominio";

/** Produto exibido no modal — subconjunto do modelo `produtos` + grupos de opcional. */
export type ProdutoModalDados = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  fotoUrl: string | null;
  /** false → selo "Esgotado" + CTA desabilitado. Default true. */
  disponivel?: boolean;
  /** Grupos de opcional disponíveis (SSR, issue 081). Vazio/ausente = sem seção. */
  gruposOpcionais?: GrupoOpcional[];
};

type ProdutoModalProps = {
  produto: ProdutoModalDados | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Confirma a adição ao carrinho com os opcionais escolhidos (qtd > 0). Os
   * opcionais carregam preço só como PREVIEW — o servidor recalcula no checkout
   * (seguranca.md §10, RN-O2). Quem chama soma no useCarrinho.
   */
  onAdicionar: (
    produtoId: string,
    quantidade: number,
    opcionais: OpcionalCarrinho[],
  ) => void;
};

/** Só `https:` vira imagem remota — anti-XSS (seguranca.md §15). */
function fotoSegura(url: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/**
 * Modal centralizado de detalhe do produto na vitrine
 * (design-claude/vitrine/produto-modal.html). Responsivo, UM componente:
 *
 *  - Mobile (< md): RETRATO empilhado — faixa primária com título, imagem grande
 *    (aspect 4/3), descrição, quantidade, opcionais e footer fixo com subtotal +
 *    CTA. O corpo inteiro rola.
 *  - Desktop (>= md): PAISAGEM 2 colunas — à esquerda imagem grande (flex-1) +
 *    DESCRIÇÃO logo abaixo dela (fonte menor, scroll próprio, sem vazar); à
 *    direita o conteúdo (título/preço/quantidade/opcionais/subtotal/CTA) com
 *    SCROLL PRÓPRIO e footer fixo. Modal mais largo (md:max-w-3xl), altura fixa.
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
  // Quantidade escolhida por opcional: opcionalId → qtd (0 = não escolhido).
  const [qtdOpcionais, setQtdOpcionais] = useState<Record<string, number>>({});

  if (!produto) return null;

  const disponivel = produto.disponivel ?? true;
  const foto = fotoSegura(produto.fotoUrl);
  const grupos = produto.gruposOpcionais ?? [];
  // Opcionais escolhidos (qtd > 0) achatados a partir dos grupos — preserva nome
  // e preço (PREVIEW) para exibição/carrinho; o servidor recalcula tudo (§10).
  const opcionaisEscolhidos: OpcionalCarrinho[] = grupos
    .flatMap((g) => g.opcionais)
    .map((o) => ({
      opcionalId: o.id,
      nome: o.nome,
      preco: o.preco,
      quantidade: qtdOpcionais[o.id] ?? 0,
    }))
    .filter((o) => o.quantidade > 0);

  // Subtotal PREVIEW: reusa calcularSubtotal (082/090) — (preco × qtd) + Σ opc×qtd
  // (opcional por linha, não multiplica pela qtd do produto).
  // Estético; o servidor recalcula do banco no checkout (seguranca.md §10).
  const subtotal = calcularSubtotal([
    {
      preco: produto.preco,
      quantidade,
      opcionais: opcionaisEscolhidos.map((o) => ({
        preco: o.preco,
        quantidade: o.quantidade,
      })),
    },
  ]);

  const ajustarOpcional = (opcionalId: string, delta: number) => {
    setQtdOpcionais((atual) => {
      const novo = Math.max(0, (atual[opcionalId] ?? 0) + delta);
      return { ...atual, [opcionalId]: novo };
    });
  };

  const confirmar = () => {
    if (!disponivel) return;
    onAdicionar(produto.id, quantidade, opcionaisEscolhidos);
    onOpenChange(false);
  };

  // Imagem em destaque. Mobile: bloco aspect-4/3 no fluxo do corpo. Desktop:
  // ocupa o espaço flexível da coluna esquerda acima da descrição (flex-1,
  // object-cover, sem scroll) — a descrição abaixo divide a altura da coluna.
  const imagem = (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[#eeeeee] bg-[linear-gradient(135deg,#4a3a22,#6b5131)] md:aspect-auto md:min-h-0 md:flex-1 md:rounded-none md:border-0">
      {foto ? (
        <Image
          src={foto}
          alt={produto.nome}
          fill
          sizes="(max-width: 480px) 100vw, (max-width: 768px) 448px, 384px"
          unoptimized
          className={`object-cover ${
            disponivel ? "" : "[filter:grayscale(0.7)_brightness(0.75)]"
          }`}
        />
      ) : null}
    </div>
  );

  // Descrição do produto. Bloco reusado nos dois layouts, mas posicionado
  // diferente: no MOBILE fica no corpo rolável (acima do preço, fluxo único);
  // no DESKTOP é renderizado SÓ na coluna esquerda, ABAIXO da imagem, com fonte
  // menor e scroll próprio se for longa (não empurra a imagem pra fora). Cada
  // chamada passa `className` extra para ajustar tamanho/scroll ao contexto.
  const descricao = produto.descricao ? (
    <p className="text-sm leading-snug text-[var(--texto-muted)]">
      {produto.descricao}
    </p>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Esconde o botão de fechar padrão do primitivo — usamos o ✕ sobre a
        // faixa primária (contraste branco), abaixo. Sem padding no container:
        // header/corpo/footer controlam o próprio espaçamento. No desktop o modal
        // fica mais largo (md:max-w-3xl) e com altura fixa para o layout paisagem.
        showCloseButton={false}
        className="gap-0 p-0 md:max-w-3xl md:h-[min(560px,calc(100dvh-2rem))] md:flex-row [&>button.absolute]:hidden"
      >
        {/* Coluna ESQUERDA (desktop) — imagem em destaque + descrição abaixo.
            É uma flex-column de altura cheia: a imagem ocupa o espaço flexível
            (flex-1) e a descrição fica colada embaixo com altura limitada e
            SCROLL PRÓPRIO se for longa, sem empurrar a imagem pra fora (§height).
            No mobile esta coluna some — imagem e descrição vão pro corpo rolável
            (renderizados de novo abaixo). min-h-0 deixa o overflow funcionar. */}
        <div className="hidden md:flex md:w-[44%] md:shrink-0 md:flex-col md:self-stretch md:min-h-0">
          {imagem}
          {descricao ? (
            <div className="max-h-[38%] shrink-0 overflow-y-auto border-t border-[#eeeeee] bg-[#f9f9f9] px-5 py-3">
              {/* Fonte menor que no mobile (text-xs) p/ caber mais descrição sem
                  estourar; scroll próprio garante que nada vaze da viewport. */}
              <p className="text-xs leading-relaxed text-[var(--texto-muted)]">
                {produto.descricao}
              </p>
            </div>
          ) : null}
        </div>

        {/* Coluna CONTEÚDO — header faixa primária + corpo rolável + footer fixo.
            No desktop é a coluna direita (flex-1) com seu PRÓPRIO scroll interno;
            no mobile é a coluna única. min-h-0/min-w-0 deixam o overflow funcionar. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Header — faixa cor primária da loja, título centralizado, ✕ no canto */}
          <div className="relative shrink-0 bg-[var(--cor-primaria)] px-12 py-4">
            <DialogTitle className="text-center text-base font-black uppercase leading-tight tracking-wide text-white">
              {produto.nome}
            </DialogTitle>
            <button
              type="button"
              aria-label="Fechar detalhes do produto"
              onClick={() => onOpenChange(false)}
              className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white hover:bg-white/25"
            >
              {/* X grande sem depender de lib aqui (a faixa é nossa) */}
              <span aria-hidden className="text-lg font-black leading-none">
                ✕
              </span>
            </button>
          </div>

          {/* Corpo rolável — imagem (só mobile) + descrição + preço + quantidade +
              opcionais. No desktop o scroll é AQUI (coluna de conteúdo), nunca na
              imagem. min-h-0 garante que o flex permita o overflow-y-auto. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Imagem grande em destaque — SÓ no mobile (no desktop é a coluna esq.) */}
            <div className="p-4 pb-3 md:hidden">{imagem}</div>

            {/* Descrição (SÓ mobile — no desktop ela fica na coluna esquerda
                abaixo da imagem). O preço NÃO se repete aqui: aparece só em
                "Cada unidade" (Quantidade) e no Subtotal do item. */}
            {descricao ? (
              <div className="px-4 pb-4 text-center md:hidden">{descricao}</div>
            ) : null}

            {/* Selo de esgotado — centralizado, nos dois layouts */}
            {!disponivel ? (
              <div className="flex justify-center px-4 pb-4 pt-1">
                <span
                  role="status"
                  className="w-fit rounded-full border-[1.5px] border-[#8B4513]/40 bg-[#8B4513] px-3 py-1 text-xs font-bold uppercase tracking-wide text-white"
                >
                  ✕ Esgotado
                </span>
              </div>
            ) : null}

            {/* Seção Quantidade — card com label + preço unitário à esq., stepper à dir. */}
            <div className="px-4 pb-4 md:pt-4">
              <div className="rounded-2xl border border-[#eeeeee] bg-[#f9f9f9] p-4">
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
                    <p className="mt-0.5 text-xs text-[var(--texto-muted)]">
                      {disponivel
                        ? `Cada unidade · ${formatarMoeda(produto.preco)}`
                        : "Produto indisponível no momento"}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Selecionar quantidade"
                    aria-disabled={!disponivel}
                    className={`flex items-center overflow-hidden rounded-[10px] border-[1.5px] border-[#dccbb0] bg-white ${
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
            </div>

            {/* Seção Opcionais (issue 087) — só quando o produto disponível tem grupos.
                Mesma estrutura grupo/opcional/mini-stepper do mockup
                (design-claude/vitrine/produto-modal.html). Preços são PREVIEW. */}
            {disponivel && grupos.length > 0 ? (
              <div className="px-4 pb-4">
                <div className="rounded-2xl border border-[#eeeeee] bg-[#f9f9f9] p-4">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-marrom-cafe">
                    Opcionais
                  </p>
                  {grupos.map((grupo) => (
                    <div key={grupo.categoriaOpcionalId} className="mt-3 first:mt-1">
                      <p className="border-t border-[#eeeeee] pt-3 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--texto-muted)] first:border-t-0 first:pt-0">
                        {grupo.categoriaOpcionalNome}
                      </p>
                      {grupo.opcionais.map((opcional) => {
                        const qtd = qtdOpcionais[opcional.id] ?? 0;
                        return (
                          <div
                            key={opcional.id}
                            className="flex items-center justify-between gap-3 border-b border-[#eeeeee] py-2.5 last:border-b-0"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-[var(--texto)]">
                                {opcional.nome}
                              </p>
                              <p className="mt-0.5 text-xs font-bold text-[var(--cor-destaque)]">
                                + {formatarMoeda(opcional.preco)}
                              </p>
                            </div>
                            <div
                              role="group"
                              aria-label={`Quantidade de ${opcional.nome}`}
                              className="flex shrink-0 items-center overflow-hidden rounded-lg border-[1.5px] border-[#dccbb0] bg-white"
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remover ${opcional.nome}`}
                                disabled={qtd <= 0}
                                onClick={() => ajustarOpcional(opcional.id, -1)}
                                className="size-9 rounded-none text-[var(--cor-destaque)]"
                              >
                                <Minus aria-hidden className="size-3.5" />
                              </Button>
                              <span
                                role="status"
                                aria-live="polite"
                                aria-label={`${opcional.nome}: ${qtd}`}
                                className="min-w-7 border-x border-[#dccbb0] px-0.5 text-center text-sm font-bold tabular-nums text-[var(--texto)]"
                              >
                                {qtd}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Adicionar ${opcional.nome}`}
                                onClick={() => ajustarOpcional(opcional.id, 1)}
                                className="size-9 rounded-none text-[var(--cor-destaque)]"
                              >
                                <Plus aria-hidden className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer fixo (não rola) — subtotal PREVIEW + CTA + "Mais itens" */}
          <div className="shrink-0 border-t border-[#eeeeee]">
            {/* Subtotal ao vivo (PREVIEW) */}
            <div
              aria-live="polite"
              aria-atomic="true"
              className={`flex items-center justify-between bg-[#f9f9f9] px-4 py-3 ${
                disponivel ? "" : "opacity-45"
              }`}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--texto-muted)]">
                Subtotal do item
              </span>
              <span className="text-lg font-black text-[var(--cor-destaque)]">
                {formatarMoeda(subtotal)}
              </span>
            </div>

            {/* CTA + ação secundária */}
            <div className="flex flex-col gap-2 p-4 pb-5">
              <Button
                type="button"
                onClick={confirmar}
                disabled={!disponivel}
                aria-label={
                  disponivel
                    ? `Adicionar ${quantidade} ${produto.nome} ao carrinho por ${formatarMoeda(subtotal)}`
                    : "Produto esgotado — não é possível adicionar ao carrinho"
                }
                className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--cor-destaque)] px-5 text-base font-black text-white hover:bg-[var(--cor-destaque)]/90 disabled:bg-[#9a9a9a]"
              >
                {disponivel ? "Adicionar ao carrinho" : "Produto esgotado"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="min-h-11 w-full text-sm font-bold uppercase tracking-wide text-[var(--cor-destaque)] hover:bg-[var(--cor-destaque)]/5"
              >
                Mais itens
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
