import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { buscarProdutosDoLojista } from "@/lib/supabase/queries/produtos";
import {
  buscarCategoriasOpcional,
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
  buscarOcultosOpcionais,
} from "@/lib/supabase/queries/opcionais";
import {
  criarCategoriaOpcional,
  atualizarCategoriaOpcional,
  removerCategoriaOpcional,
  criarOpcional,
  atualizarOpcional,
  alternarOpcionalAtivo,
  removerOpcional,
  salvarAssociacaoOpcionais,
  reordenarOpcionaisDaCategoria,
  reordenarItensDoGrupoOpcional,
  salvarOcultacoesOpcionais,
} from "@/lib/actions/opcional";
import { OpcionaisClient } from "./OpcionaisClient";

/**
 * Gestão da biblioteca de opcionais do lojista (issues 088/089). Server Component.
 *
 * Todo o I/O usa o client AUTENTICADO — a RLS (migration 080) isola por dono.
 * `loja_id` é derivado da loja do dono, nunca de input do cliente. Sem loja →
 * redireciona ao onboarding. As mutações acontecem via Server Actions
 * (lib/actions/opcional.ts) disparadas pelo `OpcionaisClient`.
 */
export default async function OpcionaisPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const [
    categoriasOpcional,
    opcionais,
    categoriasProduto,
    associacoes,
    produtos,
    ocultosOpcionais,
  ] = await Promise.all([
    buscarCategoriasOpcional(supabase, loja.id),
    buscarOpcionaisDoLojista(supabase, loja.id),
    buscarCategorias(supabase, loja.id),
    buscarAssociacoesOpcional(supabase, loja.id),
    // [331] O "Por produto" de cada grupo lista os produtos da categoria e
    // parte das ocultações gravadas. Em paralelo: a latência não sobe.
    buscarProdutosDoLojista(supabase, loja.id),
    buscarOcultosOpcionais(supabase, loja.id),
  ]);

  return (
    <OpcionaisClient
      categoriasOpcional={categoriasOpcional}
      opcionais={opcionais}
      categoriasProduto={categoriasProduto.map((c) => ({
        id: c.id,
        nome: c.nome,
      }))}
      // `ordem` (208) vai junto: é ela que abre o modo reordenar (209) na
      // sequência gravada. `buscarAssociacoesOpcional` já ordena.
      associacoes={associacoes.map((a) => ({
        categoria_id: a.categoria_id,
        categoria_opcional_id: a.categoria_opcional_id,
        ordem: a.ordem,
      }))}
      // [331] Shape estreito: o sheet só precisa de id, nome e categoria.
      produtos={produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        categoria_id: p.categoria_id,
      }))}
      ocultosOpcionais={ocultosOpcionais}
      // Actions do LOJISTA passadas explicitamente (issue 160): `acoes` é
      // obrigatória, sem default — a via admin injeta as variantes por `lojaId`.
      acoes={{
        criarCategoriaOpcional,
        atualizarCategoriaOpcional,
        removerCategoriaOpcional,
        criarOpcional,
        atualizarOpcional,
        alternarOpcionalAtivo,
        removerOpcional,
        salvarAssociacaoOpcionais,
        reordenarOpcionaisDaCategoria,
        reordenarItensDoGrupoOpcional,
        salvarOcultacoesOpcionais,
      }}
    />
  );
}
