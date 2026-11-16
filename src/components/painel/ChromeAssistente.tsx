import type { ReactElement, ReactNode } from "react";
import Image from "next/image";

import { fotoSegura } from "@/lib/utils/fotoSegura";
import { BotaoLogout } from "./NavPainel";

/**
 * Chrome mínimo do painel para loja que nunca foi ao ar (issue 368, D4): logo,
 * nome da loja e "Sair". Sem Sidebar, sem Topbar, sem link de vitrine — o
 * lojista fica no assistente de primeiros passos até publicar.
 */
export function ChromeAssistente({
  nomeLoja,
  logoUrl,
  children,
}: {
  nomeLoja: string;
  logoUrl: string | null;
  children: ReactNode;
}): ReactElement {
  const logo = fotoSegura(logoUrl);
  const inicial = nomeLoja.trim().charAt(0).toUpperCase();

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
        {logo ? (
          <Image
            src={logo}
            alt=""
            width={32}
            height={32}
            unoptimized
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
          >
            {inicial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading font-semibold">{nomeLoja}</p>
          <p className="text-xs text-muted-foreground">Primeiros passos</p>
        </div>
        <BotaoLogout className="min-h-[44px] w-auto" />
      </header>
      <main className="superficie-painel flex-1 overflow-y-auto p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
