import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaPorSlug } from "@/lib/supabase/queries/lojas";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";

/** `/loja/<slug>` (com ou sem subcaminho/query) → slug; qualquer outra coisa → null. */
function slugDoNext(next: string): string | null {
  const m = /^\/loja\/([a-z0-9-]{1,80})(?:[/?#]|$)/i.exec(next);
  return m ? m[1] : null;
}

/**
 * "Voltar para <loja>" (decisão 21 / D7): só nas telas `/conta/*`. A loja é
 * derivada só do `next` sanitizado e buscada na view pública `vitrine_lojas`;
 * `next` fora do padrão, loja inexistente/inativa ou erro de leitura → nada
 * é renderizado (sem espaço reservado). Nome renderizado por JSX (escape).
 */
export async function LinkVoltarLoja({ next }: { next: string | undefined }) {
  const destino = sanitizarNext(next);
  if (!destino) return null;
  const slug = slugDoNext(destino);
  if (!slug) return null;

  let nome: string | null = null;
  try {
    const loja = await buscarLojaPorSlug(await createClient(), slug);
    nome = loja?.nome ?? null;
  } catch (e) {
    console.error("[LinkVoltarLoja]", e instanceof Error ? e.name : "erro");
  }
  if (!nome) return null;

  return (
    <Link
      href={destino}
      className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-texto underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para {nome}
    </Link>
  );
}
