import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarCardapiosDoPainel } from "@/lib/supabase/queries/cardapios";
import {
  ligarDesligarCardapio,
  removerCardapio,
  converterExclusivosParaMenu,
} from "@/lib/actions/cardapio";
import { definirVisibilidadeEmProdutos } from "@/lib/actions/produto";
import { estadoDoCardapio } from "@/lib/utils/estadoCardapioPainel";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
import {
  contarProdutosEscondidos,
  listarProdutosEscondidos,
} from "@/lib/utils/contarProdutosEscondidos";
import { ROTA_CARDAPIOS_LOJISTA } from "@/lib/utils/rotasCardapios";
import { CardapiosClient, type LinhaCardapio } from "./CardapiosClient";

/**
 * O estado de cada cardápio é AO VIVO: ele muda com a passagem do tempo, não
 * com a escrita de ninguém. Uma resposta cacheada mostraria "Aberto agora"
 * depois de o cardápio fechar. Daí `force-dynamic` — o request é o relógio.
 */
export const dynamic = "force-dynamic";

/**
 * [256] `/painel/cardapios` — Server Component.
 *
 * Todo o I/O usa o client AUTENTICADO (a RLS da issue 242 isola por dono) e
 * `loja_id` sai de `buscarLojaDoDono`, nunca de input. O estado do badge e a
 * frase de vigência são DERIVADOS AQUI, com o relógio do SERVIDOR e o fuso da
 * LOJA: o painel nunca decide no browser se um cardápio está aberto.
 *
 * Um único `agora` para a página inteira — duas linhas nunca discordam sobre
 * que instante é este.
 */
export default async function CardapiosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const { cardapios, produtos, vinculosPorProduto } =
    await buscarCardapiosDoPainel(supabase, loja.id);
  const agora = new Date();

  const linhas: LinhaCardapio[] = cardapios.map((cardapio) => {
    // [264/RN-12] Os dois números e os NOMES saem da mesma função pura, com o
    // relógio do SERVIDOR e o fuso da LOJA. São preview de UX: nenhuma decisão
    // depende deles, e o cliente nunca os envia de volta. O predicado é um só
    // (`proximaAbertura === null`, dentro de `avaliarVigenciaDoProduto`), então
    // expirado e desligado produzem exatamente o mesmo aviso.
    const contagem = contarProdutosEscondidos(
      cardapio,
      produtos,
      vinculosPorProduto,
      agora,
      loja.timezone,
    );
    const escondidos = listarProdutosEscondidos(
      cardapio,
      produtos,
      vinculosPorProduto,
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
      // Nomear os sumidos é o que impede a confirmação de falar de um conjunto
      // e o botão converter outro: a lista e o número vêm do mesmo lugar.
      nomesEscondidos: escondidos.map((p) => p.nome),
      idsEscondidos: escondidos.map((p) => p.id),
    };
  });

  return (
    <CardapiosClient
      cardapios={linhas}
      // [269] A base das rotas deste mundo. O hub admin passa a dele; o
      // componente não conhece nenhuma das duas.
      baseCardapios={ROTA_CARDAPIOS_LOJISTA}
      acoes={{
        ligarDesligar: ligarDesligarCardapio,
        remover: removerCardapio,
        converter: converterExclusivosParaMenu,
        // [264] A saída "devolver ao menu" do aviso converte EXATAMENTE os
        // produtos nomeados no diálogo — nunca "todos os exclusivos deste
        // cardápio", que é um conjunto diferente (o exclusivo que também está
        // noutro cardápio não sumiu e não deve ser mexido).
        devolverAoMenu: definirVisibilidadeEmProdutos,
      }}
    />
  );
}
