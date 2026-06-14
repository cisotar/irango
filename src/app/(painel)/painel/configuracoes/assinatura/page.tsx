import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { CardStatusAssinatura } from "@/components/painel/StatusAssinatura";

/**
 * Página de status da assinatura (issue 060). Server Component READ-ONLY.
 *
 * Lê a loja do dono via client AUTENTICADO (RLS `lojas_leitura_propria`) e
 * exibe os campos `assinatura_*`. NENHUMA mutation — o billing é gravado só pelo
 * webhook Hotmart (057) via service_role. Rota de exceção do guard (016), logo
 * acessível mesmo com assinatura inválida.
 */
export default async function AssinaturaPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Assinatura
      </h1>
      <CardStatusAssinatura
        assinatura={{
          status: loja.assinatura_status,
          inicio: loja.assinatura_inicio,
          fimPeriodo: loja.assinatura_fim_periodo,
          subscriberCode: loja.hotmart_subscriber_code,
        }}
      />
    </main>
  );
}
