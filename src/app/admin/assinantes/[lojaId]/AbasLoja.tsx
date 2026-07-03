"use client";

import { type ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type Aba = {
  href: string;
  rotulo: string;
};

type AbasLojaProps = {
  lojaId: string;
};

/**
 * Navegação por abas do hub admin via SUB-ROTAS (issue 099) — não tabs client-only,
 * para que Cardápio (100) e Configuração (101) vivam em arquivos/rotas separados.
 * Estado ativo derivado do `usePathname` (prefixo da sub-rota), `next/link` para
 * navegação real. Renderizado pelo `layout.tsx`, envolvendo as sub-rotas.
 */
export function AbasLoja({ lojaId }: AbasLojaProps): ReactElement {
  const pathname = usePathname();
  const base = `/admin/assinantes/${lojaId}`;
  const abas: Aba[] = [
    { href: `${base}/produtos`, rotulo: "Cardápio" },
    { href: `${base}/configuracoes`, rotulo: "Configuração" },
  ];

  return (
    <nav className="flex gap-1 border-b" aria-label="Seções da loja">
      {abas.map((aba) => {
        const ativa = pathname === aba.href || pathname.startsWith(`${aba.href}/`);
        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              ativa
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {aba.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
