import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import {
  buscarCategoriasOpcional,
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
} from "@/lib/supabase/queries/opcionais";
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

  const [categoriasOpcional, opcionais, categoriasProduto, associacoes] =
    await Promise.all([
      buscarCategoriasOpcional(supabase, loja.id),
      buscarOpcionaisDoLojista(supabase, loja.id),
      buscarCategorias(supabase, loja.id),
      buscarAssociacoesOpcional(supabase, loja.id),
    ]);

  return (
    <OpcionaisClient
      categoriasOpcional={categoriasOpcional}
      opcionais={opcionais}
      categoriasProduto={categoriasProduto.map((c) => ({
        id: c.id,
        nome: c.nome,
      }))}
      associacoes={associacoes.map((a) => ({
        categoria_id: a.categoria_id,
        categoria_opcional_id: a.categoria_opcional_id,
      }))}
    />
  );
}
