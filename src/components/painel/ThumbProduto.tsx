import Image from "next/image";

import { fotoSegura } from "@/lib/utils/fotoSegura";

// Apresentação pura (sem estado): renderiza a foto do produto quando o
// `fotoUrl` é uma URL `https://` confiável (via `fotoSegura`, seguranca.md §15),
// senão um avatar neutro com a inicial do nome. Tokens semânticos do painel —
// nunca a cor da loja, nunca `ui/avatar` (seguranca.md §16).
interface ThumbProdutoProps {
  fotoUrl: string | null;
  nome: string;
}

export function ThumbProduto({ fotoUrl, nome }: ThumbProdutoProps) {
  const src = fotoSegura(fotoUrl);

  if (src) {
    return (
      <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
        <Image
          src={src}
          alt={nome}
          fill
          sizes="40px"
          unoptimized
          className="object-cover"
        />
      </div>
    );
  }

  const inicial = nome.trim().charAt(0).toUpperCase();

  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold text-muted-foreground"
      aria-hidden="true"
    >
      {inicial}
    </div>
  );
}
