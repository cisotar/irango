import type { ReactElement } from "react";

import { carregarCardapiosDoPainelAdmin } from "../carga-cardapios";
import { estadoDoCardapio } from "@/lib/utils/estadoCardapioPainel";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
import {
  contarProdutosEscondidos,
  listarProdutosEscondidos,
} from "@/lib/utils/contarProdutosEscondidos";
import type { LinhaCardapio } from "@/app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient";
import { CardapiosAdminClient } from "./CardapiosAdminClient";

/**
 * O estado de cada cardápio é AO VIVO: muda com a passagem do tempo, não com a
 * escrita de ninguém. Resposta cacheada mostraria "Aberto agora" depois de o
 * cardápio fechar.
 */
export const dynamic = "force-dynamic";

/**
 * [269 · fase 6] `/admin/assinantes/[lojaId]/cardapios` — o gêmeo admin de
 * `/painel/cardapios`. Server Component.
 *
 * A projeção é a MESMA da rota do lojista (mesmas funções puras), só que com o
 * fuso da LOJA-ALVO e um único `agora` para a página inteira: o admin edita em
 * nome do lojista e não pode ver "Aberto agora" por outro relógio.
 */
export default async function CardapiosAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { loja, cardapios, produtos, cardapiosPorProduto } =
    await carregarCardapiosDoPainelAdmin(lojaId);

  const agora = new Date();

  const linhas: LinhaCardapio[] = cardapios.map((cardapio) => {
    const contagem = contarProdutosEscondidos(
      cardapio,
      produtos,
      cardapiosPorProduto,
      agora,
      loja.timezone,
    );
    const escondidos = listarProdutosEscondidos(
      cardapio,
      produtos,
      cardapiosPorProduto,
      agora,
      loja.timezone,
    );

    return {
      id: cardapio.id,
      nome: cardapio.nome,
      ativo: cardapio.ativo,
      estado: estadoDoCardapio(cardapio, agora, loja.timezone),
      descricao: descreverVigencia(cardapio, loja.timezone, agora),
      menu: cardapio.menu,
      exclusivos: cardapio.exclusivos,
      escondidos: contagem,
      nomesEscondidos: escondidos.map((p) => p.nome),
      idsEscondidos: escondidos.map((p) => p.id),
    };
  });

  return <CardapiosAdminClient lojaId={loja.id} cardapios={linhas} />;
}
