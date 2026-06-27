import type { ReactNode, ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { carregarCabecalhoLojaAdmin } from "./cabecalho";
import { AbasLoja } from "./AbasLoja";

// Dados da loja-alvo mudam por ação admin a qualquer momento — nunca cachear.
export const dynamic = "force-dynamic";

/**
 * Layout do hub de gestão de UMA loja-alvo (issue 099). Server Component sob
 * `/admin` (o guard `verificarAdminSaaS` está em `admin/assinantes/layout.tsx`).
 *
 * Decisão de carga (layout vs sub-rota): o layout carrega só o cabeçalho LEVE
 * (`carregarCabecalhoLojaAdmin` — uma query escopada por `lojaId`, que re-prova
 * admin), enquanto cada sub-rota (cardápio/configuração — 100/101) chama
 * `carregarLojaAdmin` para o agregado completo. Assim o agregado pesado não é
 * carregado duas vezes (layout + página).
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

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link
          href="/admin/assinantes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para assinantes
        </Link>

        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {loja.nome}
            </h1>
            <Badge variant={loja.ativo ? "default" : "secondary"}>
              {loja.ativo ? "Publicada" : "Não publicada"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">/{loja.slug}</span>
          </p>

          {/* Aviso de contexto explícito (issue 099, spec "Gestão da Loja"): o admin
              está editando a loja de OUTRO lojista, não a sua própria. */}
          <div
            role="note"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            Você está editando a loja de outro lojista. Toda alteração feita aqui
            afeta a loja <span className="font-medium">{loja.nome}</span>.
          </div>
        </header>

        <AbasLoja lojaId={loja.id} />
      </div>

      {children}
    </div>
  );
}
