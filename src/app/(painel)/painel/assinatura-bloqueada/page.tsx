import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { CardStatusAssinatura } from "@/components/painel/StatusAssinatura";

/**
 * Tela de reativação (issue 060). Server Component READ-ONLY.
 *
 * Rota de exceção do guard (016): renderiza MESMO com assinatura inválida, para
 * o lojista ver o status e ir ao portal Hotmart sem cair em loop de redirect.
 * NENHUMA mutation — o billing é gravado só pelo webhook (057).
 */
export default async function AssinaturaBloqueadaPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Sua loja está fora do ar
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Regularize sua assinatura na Hotmart para reativar o painel e a
          vitrine.
        </p>
      </div>
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
