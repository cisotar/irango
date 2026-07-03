import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { verificarAdminSaaS } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Assinantes · Admin iRango",
  // Tela interna do dono do SaaS — não indexar.
  robots: { index: false, follow: false },
};

/**
 * Guard AUTORITATIVO da área admin (RN-13, issue 082). Server Component.
 *
 * `verificarAdminSaaS()` LANÇA se a sessão não for a do `SAAS_ADMIN_USER_ID`
 * (fail-closed). Sem este guard, a página renderizaria dados de TODAS as lojas
 * (e-mail do dono = PII + status de billing) para qualquer lojista autenticado.
 * As Server Actions também verificam — mas a UI não pode sequer ser exibida.
 *
 * Qualquer falha (não-admin, sessão inválida, env ausente) → redirect silencioso
 * p/ `/painel`. Detalhe só no `console.error` de `admin.ts`, nunca vaza ao cliente.
 *
 * NÃO envolve `children` num container/`<main>` (issue 145): o hub `[lojaId]`
 * monta seu próprio shell full-height com o seu único `<main>` — um `<main>`
 * aqui aninharia (HTML/a11y inválido) e espremeria o shell. A lista de
 * assinantes (`page.tsx`) carrega o container `max-w-6xl` por conta própria.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  try {
    await verificarAdminSaaS();
  } catch {
    redirect("/painel");
  }

  return children;
}
