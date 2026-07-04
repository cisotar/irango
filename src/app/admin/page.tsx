import type { ReactElement } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Store, Users } from "lucide-react";

import { verificarAdminSaaS } from "@/lib/auth/admin";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "iRango · Admin",
  // Tela interna do dono do SaaS — não indexar (espelha assinantes/layout.tsx).
  robots: { index: false, follow: false },
};

/**
 * Hub de seleção do dono do SaaS (RN-13, issue 149). Server Component.
 *
 * Gate 100% servidor: `verificarAdminSaaS()` LANÇA se a sessão não for a do
 * `SAAS_ADMIN_USER_ID` (fail-closed). Só depois de resolver é que os cards
 * montam. Qualquer falha (não-admin, sessão inválida, env ausente) → redirect
 * silencioso p/ `/painel`; o detalhe já é logado em `admin.ts`, nunca vaza aqui.
 *
 * O `try` envolve SOMENTE o guard: o `redirect()` fica no `catch`, fora de
 * qualquer `try` aninhado, para o `NEXT_REDIRECT` propagar (não ser reengolido).
 * O `return` dos cards fica FORA do try de propósito.
 */
export default async function AdminHubPage(): Promise<ReactElement> {
  try {
    await verificarAdminSaaS();
  } catch {
    redirect("/painel");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Painel do iRango
        </h1>
        <p className="text-sm text-muted-foreground">
          Escolha o que você quer gerenciar agora.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/painel"
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Card className="h-full transition-shadow hover:ring-foreground/25 hover:shadow-md">
            <CardHeader className="gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-foreground">
                <Store className="size-5" aria-hidden />
              </div>
              <CardTitle>Minha loja</CardTitle>
              <CardDescription>
                Gerencie o cardápio, pedidos e configurações da sua própria loja.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link
          href="/admin/assinantes"
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Card className="h-full transition-shadow hover:ring-foreground/25 hover:shadow-md">
            <CardHeader className="gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-foreground">
                <Users className="size-5" aria-hidden />
              </div>
              <CardTitle>Clientes</CardTitle>
              <CardDescription>
                Acompanhe as lojas assinantes: assinatura, cortesia e suspensão.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </main>
  );
}
