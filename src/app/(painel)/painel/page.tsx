import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarPedidosDoDono } from "@/lib/supabase/queries/pedidos";
import { DashboardLoja } from "@/components/painel/DashboardLoja";

/**
 * Dashboard do lojista (issue 048). Server Component — casca fina (issue 122).
 *
 * Todo o I/O usa o client AUTENTICADO — a RLS `pedidos_acesso_lojista` isola os
 * pedidos por loja (RN-02). Sem loja → redireciona ao onboarding. A UI do
 * dashboard vive em `<DashboardLoja>`, componente compartilhado com a page
 * admin (issue 138); aqui ficam só auth/query e o chrome da rota (título).
 */
export default async function DashboardPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const pedidos = await listarPedidosDoDono(supabase);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Dashboard
      </h1>

      <DashboardLoja pedidos={pedidos} />
    </div>
  );
}
