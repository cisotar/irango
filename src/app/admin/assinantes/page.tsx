import type { ReactElement } from "react";

import { createServiceClient } from "@/lib/supabase/service";
import { listarAssinantes } from "@/lib/supabase/queries/adminAssinatura";
import { TabelaAssinantes } from "./TabelaAssinantes";

// Dados de billing mudam por webhook/ação a qualquer momento — nunca cachear.
export const dynamic = "force-dynamic";

/**
 * Tela admin de assinantes (issue 082). Server Component: lê TODAS as lojas via
 * service_role (sem RLS de dono). O guard de identidade é o `layout.tsx`
 * (`verificarAdminSaaS`) — este componente já assume sessão de admin provada.
 *
 * NENHUM dado de billing é editável aqui: a tabela é read-only e toda mutação
 * passa pelas Server Actions (`actions.ts`), que revalidam o status no servidor.
 */
export default async function AssinantesPage(): Promise<ReactElement> {
  const svc = createServiceClient();
  const assinantes = await listarAssinantes(svc);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Assinantes
        </h1>
        <p className="text-sm text-muted-foreground">
          {assinantes.length} loja(s). Cortesia, suspensão e reativação aplicam o
          status no servidor.
        </p>
      </header>

      <TabelaAssinantes assinantes={assinantes} />
    </div>
  );
}
