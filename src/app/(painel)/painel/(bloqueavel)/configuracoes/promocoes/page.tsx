import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { listarModaisSazonaisDoDono } from "@/lib/supabase/queries/modaisSazonais";
import {
  criarModalSazonal,
  editarModalSazonal,
  ativarModalSazonal,
  desativarModalSazonal,
  removerModalSazonal,
} from "@/lib/actions/modalSazonal";
import { montarLinhasModalSazonal } from "./montarLinhasModalSazonal";
import { PromocoesClient } from "./PromocoesClient";

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
    redirect("/painel");
  }

  // Uma leitura por eixo, em paralelo: os modais do dono (com a seleção
  // embutida) e as categorias da loja para os checkboxes. [323/S6] O eixo
  // `cardapios` saiu do editor (o cardápio sazonal virou função morta); a
  // seleção salva continua em `modal.cardapios` e é repassada intacta.
  const [modais, categorias] = await Promise.all([
    listarModaisSazonaisDoDono(supabase, loja.id),
    buscarCategorias(supabase, loja.id),
  ]);

  // Um único `agora` para a página inteira, e a MESMA montagem de linha da via
  // admin (`montarLinhasModalSazonal`): parse fail-closed da mensagem (RN-M04) e
  // `estado` como preview de UX derivado no SERVIDOR a cada request.
  const linhas = montarLinhasModalSazonal(modais, loja.id, new Date());

  return (
    <PromocoesClient
      modais={linhas}
      // As categorias da loja para os checkboxes de seleção.
      categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
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
