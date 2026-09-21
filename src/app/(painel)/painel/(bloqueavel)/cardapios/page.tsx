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
import { estadoDoCardapio } from "@/lib/utils/estadoCardapioPainel";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
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

  const cardapios = await buscarCardapiosDoPainel(supabase, loja.id);
  const agora = new Date();

  const linhas: LinhaCardapio[] = cardapios.map((cardapio) => ({
    id: cardapio.id,
    nome: cardapio.nome,
    ativo: cardapio.ativo,
    estado: estadoDoCardapio(cardapio, agora, loja.timezone),
    descricao: descreverVigencia(cardapio, loja.timezone, agora),
    menu: cardapio.menu,
    exclusivos: cardapio.exclusivos,
  }));

  return (
    <CardapiosClient
      cardapios={linhas}
      acoes={{
        ligarDesligar: ligarDesligarCardapio,
        remover: removerCardapio,
        converter: converterExclusivosParaMenu,
      }}
    />
  );
}
