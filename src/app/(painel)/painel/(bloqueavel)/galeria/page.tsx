import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { GaleriaImagens } from "@/components/painel/GaleriaImagens";
import {
  consultarUsoImagens,
  enviarImagemGaleria,
  listarImagensGaleria,
  removerImagensGaleria,
} from "@/lib/actions/galeria";
import type { UsoImagem } from "@/lib/actions/galeria-contrato";
import { createClient } from "@/lib/supabase/server";
import {
  buscarUsoDasImagens,
  contarOriginaisDaLoja,
  listarImagensDaLoja,
} from "@/lib/supabase/queries/imagens";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";

/**
 * Galeria do lojista (specs/galeria-imagens-loja.md, página 1). Server
 * Component dentro de `(bloqueavel)`: o paywall do layout vale aqui como em
 * Produtos.
 *
 * Todo I/O usa o client AUTENTICADO — a RLS de `imagens_loja` isola por dono e
 * a `loja_id` é a da loja do auth, nunca de input. Primeira página, contagem do
 * teto (prévia; a autoritativa é a da action) e o uso da primeira página para o
 * selo "Em uso". As mutações são as Server Actions do LOJISTA, injetadas em
 * `acoes` (obrigatória, sem default — issue 160).
 */
export default async function GaleriaPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel");
  }

  const [pagina, total] = await Promise.all([
    listarImagensDaLoja(supabase, loja.id),
    contarOriginaisDaLoja(supabase, loja.id),
  ]);

  // O selo é prévia: sem ele a página segue, e a remoção reconsulta o uso.
  const usos: UsoImagem[] = await buscarUsoDasImagens(
    supabase,
    loja.id,
    pagina.imagens.map((i) => i.id),
  ).catch((e: unknown) => {
    console.error("[GaleriaPage] uso da primeira página", e);
    return [];
  });

  return (
    <GaleriaImagens
      voltarHref="/painel"
      voltarRotulo="Painel"
      imagensIniciais={pagina.imagens}
      cursorInicial={pagina.proximo_cursor}
      totalInicial={total}
      usosIniciais={usos}
      acoes={{
        enviarImagem: enviarImagemGaleria,
        listarMais: listarImagensGaleria,
        consultarUso: consultarUsoImagens,
        remover: removerImagensGaleria,
      }}
    />
  );
}
