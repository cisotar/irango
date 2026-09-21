import type { ReactElement } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  buscarCardapioPorId,
  buscarCardapiosComProdutos,
} from "@/lib/supabase/queries/cardapios";
import { buscarProdutosDoLojista } from "@/lib/supabase/queries/produtos";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import {
  atualizarCardapio,
  aplicarCardapioEmProdutos,
  aplicarCardapioEmCategoria,
  tirarDeCardapio,
  preverLoteAction,
} from "@/lib/actions/cardapio";
import { definirVisibilidadeEmProdutos } from "@/lib/actions/produto";
import { horaLocalNoFuso, rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { rotuloAgora, descreverVigencia } from "@/lib/utils/descreverVigencia";
import { cardapioAberto, visibilidadeDe } from "@/lib/utils/vigenciaCardapio";
import { ROTA_CARDAPIOS_LOJISTA } from "@/lib/utils/rotasCardapios";
import { FormVigencia } from "@/components/painel/FormVigencia";
import {
  SeletorProdutosDoCardapio,
  type GrupoDoSeletor,
} from "@/components/painel/SeletorProdutosDoCardapio";

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

  // [260] A lista da loja inteira agrupada por categoria + quem já está neste
  // cardápio. Duas idas ao banco em paralelo, nenhuma por produto: o índice
  // `produto → cardápios` de `buscarCardapiosComProdutos` é o mesmo que a
  // vitrine consome, e é dele que sai `noCardapio`.
  const [produtos, categorias, { cardapiosPorProduto }] = await Promise.all([
    buscarProdutosDoLojista(supabase, loja.id),
    buscarCategorias(supabase, loja.id),
    buscarCardapiosComProdutos(supabase, loja.id),
  ]);

  const grupos: GrupoDoSeletor[] = [
    ...categorias.map((categoria) => ({
      id: categoria.id as string | null,
      nome: categoria.nome,
      produtos: produtos.filter((p) => p.categoria_id === categoria.id),
    })),
    {
      id: null,
      nome: "Sem categoria",
      produtos: produtos.filter((p) => p.categoria_id == null),
    },
  ]
    .filter((grupo) => grupo.produtos.length > 0)
    .map((grupo) => ({
      id: grupo.id,
      nome: grupo.nome,
      produtos: grupo.produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        // Estreitamento FAIL-OPEN de D14, o mesmo da vitrine (247/D6).
        exclusivo: visibilidadeDe(p) === "cardapio",
        noCardapio: (cardapiosPorProduto.get(p.id) ?? []).some(
          (c) => c.id === cardapioId,
        ),
      })),
    }));

  return (
    <div className="flex flex-col gap-4">
      <Link href={ROTA_CARDAPIOS_LOJISTA} className="text-sm underline">
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
        voltarHref={ROTA_CARDAPIOS_LOJISTA}
      />

      <SeletorProdutosDoCardapio
        cardapio={{
          id: cardapio.id,
          nome: cardapio.nome,
          // A frase de vigência que o diálogo de confirmação mostra — redigida
          // no SERVIDOR, com o fuso da loja (a mesma de `/painel/cardapios`).
          descricao: descreverVigencia(cardapio, loja.timezone, agora),
        }}
        grupos={grupos}
        acoes={{
          aplicarEmProdutos: aplicarCardapioEmProdutos,
          aplicarEmCategoria: aplicarCardapioEmCategoria,
          tirarDeCardapio,
          preverLote: preverLoteAction,
          definirVisibilidade: definirVisibilidadeEmProdutos,
        }}
      />
    </div>
  );
}
