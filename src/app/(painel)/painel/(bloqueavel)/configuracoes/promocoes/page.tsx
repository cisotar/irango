import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { buscarCardapiosComProdutos } from "@/lib/supabase/queries/cardapios";
import { listarModaisSazonaisDoDono } from "@/lib/supabase/queries/modaisSazonais";
import {
  criarModalSazonal,
  editarModalSazonal,
  ativarModalSazonal,
  desativarModalSazonal,
  removerModalSazonal,
} from "@/lib/actions/modalSazonal";
import { estadoDoModalSazonal } from "@/lib/utils/estadoModalSazonal";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
import { PromocoesClient, type ModalSazonalLinha } from "./PromocoesClient";

/**
 * O estado de cada modal ("Ativo"/"Rascunho"/"Fora da janela") é AO VIVO: muda
 * com a passagem do tempo, não com a escrita de ninguém. Uma resposta cacheada
 * mostraria "Ativo" depois de a janela de exibição fechar. Daí `force-dynamic`
 * — o request é o relógio. Mesmo motivo de `/painel/cardapios`.
 */
export const dynamic = "force-dynamic";

/**
 * [302] `/painel/configuracoes/promocoes` — Server Component.
 *
 * Casca de UI sobre as Server Actions e o schema da issue 301. Todo o I/O usa o
 * client AUTENTICADO (RLS isola por dono) e `loja_id` sai de `buscarLojaDoDono`,
 * nunca de input. O estado ao vivo do badge é DERIVADO AQUI, com o relógio do
 * SERVIDOR — o painel nunca decide no browser se um modal está no ar.
 *
 * Um único `agora` para a página inteira: duas linhas nunca discordam sobre que
 * instante é este.
 */
export default async function PromocoesPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  // Uma leitura por eixo, em paralelo: os modais do dono (com a seleção
  // embutida), as categorias e os cardápios da loja para os checkboxes.
  const [modais, categorias, { cardapios }] = await Promise.all([
    listarModaisSazonaisDoDono(supabase, loja.id),
    buscarCategorias(supabase, loja.id),
    buscarCardapiosComProdutos(supabase, loja.id),
  ]);

  const agora = new Date();

  const linhas: ModalSazonalLinha[] = modais.map((modal) => ({
    id: modal.id,
    titulo: modal.titulo,
    ativo: modal.ativo,
    exibicao_inicio: modal.exibicao_inicio,
    exibicao_fim: modal.exibicao_fim,
    mostrar_promocoes_junto: modal.mostrar_promocoes_junto,
    categorias: modal.categorias,
    cardapios: modal.cardapios,
    // Preview de UX recalculado no servidor a cada request (spec §Behaviors):
    // nenhuma decisão depende dele; o cliente nunca o envia de volta.
    estado: estadoDoModalSazonal(modal, agora),
  }));

  return (
    <PromocoesClient
      modais={linhas}
      // As categorias e os cardápios da loja para os checkboxes de seleção. A
      // vigência do cardápio é descrita AQUI (função pura, fuso da loja) — não é
      // reescrita no cliente.
      categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
      cardapios={cardapios.map((c) => ({
        id: c.id,
        nome: c.nome,
        vigencia: descreverVigencia(c, loja.timezone, agora),
      }))}
      // Actions do LOJISTA passadas explicitamente (issue 160): `acoes` é
      // obrigatória, sem default — a via admin injetaria variantes por `lojaId`.
      acoes={{
        criar: criarModalSazonal,
        editar: editarModalSazonal,
        ativar: ativarModalSazonal,
        desativar: desativarModalSazonal,
        remover: removerModalSazonal,
      }}
    />
  );
}
