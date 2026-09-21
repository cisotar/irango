import type { ReactElement } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarCardapioPorId } from "@/lib/supabase/queries/cardapios";
import { atualizarCardapio } from "@/lib/actions/cardapio";
import { horaLocalNoFuso, rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { rotuloAgora } from "@/lib/utils/descreverVigencia";
import { cardapioAberto } from "@/lib/utils/vigenciaCardapio";
import { FormVigencia } from "@/components/painel/FormVigencia";

export const dynamic = "force-dynamic";

/**
 * [257][258][259] `/painel/cardapios/[cardapioId]` — Server Component.
 *
 * A linha "Agora:" da prévia é montada AQUI (design §9.4 item 3): ela é o
 * veredito de `cardapioAberto` no instante do request, com o fuso da loja.
 * Derivá-la do relógio do browser diria ao lojista algo que o cliente não vê.
 *
 * Id inexistente e id de outra loja caem no MESMO `notFound()` — a rota não
 * vira oráculo de existência (a autorização é a RLS mais o `.eq("loja_id")`).
 */
export default async function CardapioDetalhePage({
  params,
}: {
  params: Promise<{ cardapioId: string }>;
}): Promise<ReactElement> {
  const { cardapioId } = await params;
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const cardapio = await buscarCardapioPorId(supabase, loja.id, cardapioId);
  if (cardapio == null) notFound();

  const agora = new Date();

  return (
    <div className="flex flex-col gap-4">
      <Link href="/painel/cardapios" className="text-sm underline">
        Voltar para cardápios
      </Link>
      <h1 className="text-xl font-semibold">{cardapio.nome}</h1>
      <FormVigencia
        cardapio={cardapio}
        timezone={loja.timezone}
        fusoRotulo={rotuloFusoLoja(loja.timezone, agora)}
        agoraLocal={horaLocalNoFuso(agora.toISOString(), loja.timezone)}
        linhaAgora={rotuloAgora(
          agora,
          loja.timezone,
          cardapioAberto(cardapio, agora, loja.timezone),
        )}
        salvar={atualizarCardapio.bind(null, cardapioId)}
        voltarHref="/painel/cardapios"
      />
    </div>
  );
}
