import type { ReactNode, ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SidebarPainel, TopbarPainel } from "@/components/painel/NavPainel";
import { carregarCabecalhoLojaAdmin } from "./cabecalho";

// Dados da loja-alvo mudam por ação admin a qualquer momento — nunca cachear.
export const dynamic = "force-dynamic";

/**
 * Shell do hub de gestão de UMA loja-alvo (issue 145). Server Component sob
 * `/admin` (o guard `verificarAdminSaaS` está em `admin/assinantes/layout.tsx`
 * e é re-provado em `carregarCabecalhoLojaAdmin` por request).
 *
 * Paridade visual com o painel do lojista: monta `SidebarPainel`/`TopbarPainel`
 * PARAMETRIZADOS pelo contexto admin (só o basePath da loja-alvo) — nenhum
 * markup de nav copiado. A identidade da loja-alvo e o aviso de contexto vivem
 * na FAIXA persistente da coluna de conteúdo (visível nos dois breakpoints, em
 * todas as áreas) — não dentro da Sidebar/Topbar, que se escondem por
 * breakpoint.
 *
 * Nav/faixa são UX pura: nenhum link concede poder. A barreira real de acesso é
 * `verificarAdminSaaS()` + as Server Actions admin escopadas por `loja_id` no
 * servidor — não a presença ou ausência de um item de menu.
 *
 * Decisão de carga (layout vs sub-rota): o layout carrega só o cabeçalho LEVE
 * (`carregarCabecalhoLojaAdmin`), enquanto cada sub-rota carrega seu agregado.
 */
export default async function HubLojaLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const loja = await carregarCabecalhoLojaAdmin(lojaId);

  const contexto = { basePath: `/admin/assinantes/${lojaId}` };

  return (
    <div className="flex min-h-svh">
      <SidebarPainel contexto={contexto} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopbarPainel contexto={contexto} />

        {/* Faixa de contexto persistente (issue 145): Voltar + nome + Badge +
            aviso amber. Fica na coluna de conteúdo (acima de children) para
            aparecer em desktop E mobile, em todas as áreas. */}
        <div className="space-y-3 border-b bg-amber-50 px-4 py-3 dark:bg-amber-950/40 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/admin/assinantes"
              className="inline-flex items-center gap-1.5 text-sm text-amber-900/80 transition-colors hover:text-amber-900 dark:text-amber-200/80 dark:hover:text-amber-100"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Voltar para assinantes
            </Link>
            <span className="font-heading text-base font-semibold text-amber-950 dark:text-amber-100">
              {loja.nome}
            </span>
            <Badge variant={loja.ativo ? "default" : "secondary"}>
              {loja.ativo ? "Publicada" : "Não publicada"}
            </Badge>
          </div>
          <p role="note" className="text-sm text-amber-900 dark:text-amber-200">
            Você está editando a loja de outro lojista. Toda alteração feita aqui
            afeta a loja <span className="font-medium">{loja.nome}</span>.
          </p>
        </div>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
