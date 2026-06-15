import type { ReactNode, ReactElement } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  buscarLojaDoDono,
  type LojaCompleta,
} from "@/lib/supabase/queries/lojas";
import { decidirAcessoPainel } from "@/lib/utils/acessoPainel";
import { SidebarPainel, TopbarPainel } from "@/components/painel/NavPainel";

/**
 * Guard ÚNICO e AUTORITATIVO do painel (issue 016). Server Component.
 * Orquestra o I/O (sessão + loja) e APLICA a decisão de `decidirAcessoPainel`.
 * A regra de authz vive na função pura; aqui só há I/O + redirect.
 *
 * Fail-closed (§14, D5): qualquer erro de I/O → redirect p/ login, detalhe só
 * no `console.error`, nunca vaza ao cliente.
 */
export default async function PainelLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const headerList = await headers();
  const rota = headerList.get("x-pathname") ?? "/painel";

  let user: User | null;
  let loja: LojaCompleta | null;
  try {
    const supabase = await createClient();
    user = (await supabase.auth.getUser()).data.user;
    loja = user ? await buscarLojaDoDono(supabase) : null;
  } catch (e) {
    console.error("[guardPainel]", e);
    redirect("/login?erro=sessao");
  }

  const decisao = decidirAcessoPainel(user, loja, rota, new Date());

  switch (decisao) {
    case "login":
      redirect("/login");
    case "confirmar-email":
      redirect("/confirmar-email");
    case "onboarding":
      redirect("/painel/onboarding");
    case "assinatura-bloqueada":
      redirect("/painel/assinatura-bloqueada");
    case "ok":
      return (
        <div className="flex min-h-svh">
          <SidebarPainel />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopbarPainel />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">
              {children}
            </main>
          </div>
        </div>
      );
  }
}
