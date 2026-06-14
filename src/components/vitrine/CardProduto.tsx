"use client";

import Image from "next/image";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

type CardProdutoProps = {
  id: string;
  nome: string;
  descricao?: string | null;
  preco: number;
  fotoUrl?: string | null;
  onAdicionar: () => void;
};

/** Só `https:` é renderizado como imagem remota — anti-XSS (seguranca.md §15). */
function fotoSegura(url?: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/**
 * Card de produto da vitrine. Apresentação pura — sem lógica de carrinho: o
 * pai decide o que `onAdicionar` faz. Botão usa `--cor-primaria` com texto
 * branco fixo (contraste seguro, design-system §4). Preço via `formatarMoeda`.
 */
export function CardProduto({
  nome,
  descricao,
  preco,
  fotoUrl,
  onAdicionar,
}: CardProdutoProps) {
  const foto = fotoSegura(fotoUrl);

  return (
    <Card className="gap-0 py-0">
      {foto ? (
        <Image
          src={foto}
          alt={nome}
          width={400}
          height={300}
          unoptimized
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="aspect-[4/3] w-full bg-muted"
        />
      )}

      <div className="flex flex-col gap-2 p-4">
        <h3 className="text-base font-semibold">{nome}</h3>
        {descricao ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {descricao}
          </p>
        ) : null}

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-lg font-bold">{formatarMoeda(preco)}</span>
          <Button
            type="button"
            onClick={onAdicionar}
            className="min-h-11 bg-[var(--cor-primaria)] text-white hover:bg-[var(--cor-primaria)]/90"
          >
            <Plus aria-hidden className="size-4" />
            Adicionar
          </Button>
        </div>
      </div>
    </Card>
  );
}
