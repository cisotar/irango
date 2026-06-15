import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarProdutosDoLojista } from "@/lib/supabase/queries/produtos";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { ProdutosClient } from "./ProdutosClient";

/**
 * Página de gestão de produtos do lojista (issue 044). Server Component.
 *
 * Todo o I/O usa o client AUTENTICADO — a RLS (`produtos_leitura_propria` /
 * `categorias`) isola por dono. `loja_id` é derivado da loja do dono, nunca de
 * input do cliente. Sem loja → redireciona ao onboarding/perfil. As mutações
 * acontecem via Server Actions (issue 031) disparadas pelo `ProdutosClient`.
 */
export default async function ProdutosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const [produtos, categorias] = await Promise.all([
    buscarProdutosDoLojista(supabase, loja.id),
    buscarCategorias(supabase, loja.id),
  ]);

  return (
    <ProdutosClient
      lojaSlug={loja.slug}
      lojaId={loja.id}
      produtos={produtos}
      categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
    />
  );
}
