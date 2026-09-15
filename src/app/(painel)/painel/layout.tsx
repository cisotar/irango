import type { ReactNode, ReactElement } from "react";
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarLojaDoDono,
  garantirLojaDoDono,
  type LojaCompleta,
} from "@/lib/supabase/queries/lojas";
import { decidirAcessoBase } from "@/lib/utils/acessoPainel";
import { ehAdminSaaS } from "@/lib/auth/admin";
import { VERSAO_TERMOS } from "@/lib/constants/termos";
import { THEME_PADRAO } from "@/lib/utils/manifest";
import {
  SidebarPainel,
  TopbarPainel,
  type ContextoNav,
} from "@/components/painel/NavPainel";
import type { Horarios } from "@/lib/utils/lojaAberta";

export const metadata: Metadata = {
  manifest: "/painel/manifest.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: THEME_PADRAO,
};

/**
 * Guard de SESSÃO/IDENTIDADE e dono do chrome do painel (issue 016 / 142).
 * Server Component. Orquestra o I/O (sessão + loja) e APLICA `decidirAcessoBase`
 * (sessão → email → loja). O gate de ASSINATURA saiu daqui: virou posicional,
 * no layout aninhado `(bloqueavel)/layout.tsx` (issue 142). Não lê mais
 * `headers()` nem qualquer header de rota — authz não depende de dado de transporte.
 *
 * Fail-closed (§14, D5): qualquer erro de I/O → redirect p/ login, detalhe só
 * no `console.error`, nunca vaza ao cliente.
 */
export default async function PainelLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
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

  const decisao = decidirAcessoBase(user, loja);

  switch (decisao) {
    case "login":
      redirect("/login");
    case "confirmar-email":
      redirect("/confirmar-email");
    case "onboarding": {
      // User órfão (sessão + email OK, sem loja): em vez de mandar para uma tela
      // de onboarding inexistente, AUTO-CURA — cria a loja via service_role e
      // recarrega o painel. `decidirAcessoBase` só devolve "onboarding" quando
      // `user` é não-nulo e tem email confirmado, então o `!` é seguro aqui.
      // `user.id`/`user.email` são AUTORITATIVOS (getUser server-side), nunca do
      // browser; a versão dos termos é a constante do servidor. Fail-closed: se a
      // cura falhar, cai no catch → login (nunca renderiza painel sem loja).
      try {
        await garantirLojaDoDono(
          createServiceClient(),
          user!.id,
          user!.email ?? "",
          VERSAO_TERMOS,
        );
      } catch (e) {
        console.error("[guardPainel] auto-cura loja órfã falhou", e);
        redirect("/login?erro=sessao");
      }
      redirect("/painel");
    }
    case "ok": {
      // `decidirAcessoBase` só devolve "ok" com `user` E `loja` não-nulos —
      // mesmos `!` já usados no ramo de onboarding. Identidade da loja + conta
      // logada alimentam o shell (issue 194): nada aqui concede poder, é UX;
      // a barreira real continua sendo RLS + guards de rota.
      // Mesma conta pode ser dono de loja E dono do SaaS (`SAAS_ADMIN_USER_ID`).
      // `ehAdminSaaS` é fail-safe (nunca lança) — link a mais nunca bloqueia o
      // painel; é só atalho de UX, a barreira real segue em `verificarAdminSaaS`.
      const contexto: ContextoNav = {
        nomeLoja: loja!.nome,
        logoUrl: loja!.logo_url,
        slugLoja: loja!.slug,
        horarios: loja!.horarios as unknown as Horarios,
        timezone: loja!.timezone,
        emailConta: user!.email ?? undefined,
        ...(ehAdminSaaS(user!.id)
          ? { voltarHref: "/admin", voltarRotulo: "Voltar ao hub admin" }
          : {}),
      };
      return (
        <div className="flex h-svh">
          <SidebarPainel contexto={contexto} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopbarPainel contexto={contexto} />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">
              {children}
            </main>
          </div>
        </div>
      );
    }
  }
}
