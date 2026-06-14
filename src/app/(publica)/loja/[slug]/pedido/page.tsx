import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  listarFormasPagamento,
  listarZonasComTaxas,
} from "@/lib/supabase/queries/entregaPagamento";
import { buscarLojaPorSlug, type LojaPublica } from "@/lib/supabase/queries/lojas";
import { lojaAberta, type Horarios } from "@/lib/utils/lojaAberta";
import { CheckoutClient } from "./CheckoutClient";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = await createClient();
  const loja = await buscarLojaPorSlug(db, slug);
  if (!loja || !loja.nome) {
    return { title: "Loja não encontrada — iRango" };
  }
  return { title: `Finalizar pedido — ${loja.nome} — iRango` };
}

/** Horários do JSONB → shape de lojaAberta (fail-safe se ausente). */
function resolverHorarios(horarios: LojaPublica["horarios"]): Horarios {
  return (horarios ?? {}) as Horarios;
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug } = await params;
  const db = await createClient();

  const loja = await buscarLojaPorSlug(db, slug);
  if (!loja || !loja.id || !loja.nome) notFound();

  const lojaId = loja.id;

  const [zonasComTaxa, formas] = await Promise.all([
    listarZonasComTaxas(db, lojaId),
    listarFormasPagamento(db, lojaId),
  ]);

  // Preview de "loja aberta" — o servidor (criarPedido/RN-09) é a verdade final.
  const aberta = lojaAberta(
    resolverHorarios(loja.horarios),
    new Date(),
    loja.timezone ?? "America/Sao_Paulo",
  ).aberta;

  const zonas = zonasComTaxa
    .filter((z) => z.ativo && z.taxa !== null)
    .map((z) => ({ id: z.id, nome: z.nome, taxaEntrega: z.taxa?.taxa ?? 0 }));

  const formasPagamento = formas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
  }));

  return (
    <CheckoutClient
      lojaId={lojaId}
      lojaSlug={slug}
      lojaNome={loja.nome}
      lojaAberta={aberta}
      zonas={zonas}
      formasPagamento={formasPagamento}
    />
  );
}
