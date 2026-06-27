import type { ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormNovaLoja } from "./FormNovaLoja";

// Sem dados a cachear; mantém paridade com a tela de assinantes (force-dynamic).
export const dynamic = "force-dynamic";

/**
 * Tela admin de criação de loja (issue 098). Server Component fino sob `/admin`,
 * já protegido pelo guard `verificarAdminSaaS` no `layout.tsx` — não repete a
 * checagem de identidade. Toda autoridade (resolução de dono, unicidade de slug,
 * defaults de cadastro) vive na Server Action `criarLojaAdmin` (087); aqui só
 * renderiza o formulário client.
 */
export default function NovaLojaPage(): ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={
            <Link href="/admin/assinantes">
              <ArrowLeft aria-hidden />
              Voltar
            </Link>
          }
        />
      </div>

      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Nova loja
        </h1>
        <p className="text-sm text-muted-foreground">
          Cadastre uma loja em nome de um lojista existente. O endereço (slug) e a
          conta de dono são validados no servidor.
        </p>
      </header>

      <FormNovaLoja />
    </div>
  );
}
