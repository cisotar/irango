import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  buscarPlanoAtivo,
  listarPlanosAtivos,
} from "@/lib/supabase/queries/planos";
import { listarFaturasDaLoja } from "@/lib/supabase/queries/pagamentosAssinatura";
import { CartaoStatusAssinatura } from "@/components/painel/CartaoStatusAssinatura";
import { AvisoEstadoBloqueado } from "@/components/painel/AvisoEstadoBloqueado";
import { TabelaFaturas } from "@/components/painel/TabelaFaturas";
import {
  GerenciarAssinaturaClient,
  type PlanoView,
} from "@/components/painel/GerenciarAssinaturaClient";
import { temAssinaturaAtiva } from "@/components/painel/rotulosAssinatura";

/**
 * Central de assinatura do lojista (issue 081, modelo de billing próprio).
 * Server Component — lê TODO valor autoritativo do servidor:
 *   - `lojas.assinatura_*` + plano atual (RLS escopa por `auth.uid()`).
 *   - planos ativos (catálogo global) e faturas (`pagamentos_assinatura`, RLS por loja).
 *
 * A UI NUNCA calcula preço/total: o `preco` vem de `planos.preco` e o `valor` das
 * faturas vem do webhook (077). O componente client só envia `plano_id` às
 * Server Actions (078); a autoridade de valor/status fica no servidor.
 *
 * Rota de exceção do guard de assinatura (016): acessível mesmo com assinatura
 * inválida — é onde o lojista regulariza.
 */
export default async function AssinaturaPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  // Plano atual + catálogo + faturas em paralelo (todas escopadas por RLS via
  // client autenticado). `planos` é catálogo global e legível pelo lojista.
  const [planoAtual, planos, faturas] = await Promise.all([
    loja.plano_id ? buscarPlanoAtivo(supabase, loja.plano_id) : Promise.resolve(null),
    listarPlanosAtivos(supabase),
    listarFaturasDaLoja(supabase),
  ]);

  const planosView: PlanoView[] = planos.map((p) => ({
    id: p.id,
    nome: p.nome,
    preco: p.preco,
    intervalo: p.intervalo,
  }));

  const temAssinatura = temAssinaturaAtiva(
    loja.assinatura_status,
    loja.provider_subscription_id,
  );

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <h1 className="font-heading text-xl font-semibold text-foreground">
        Assinatura
      </h1>

      <AvisoEstadoBloqueado status={loja.assinatura_status} />

      <CartaoStatusAssinatura
        assinatura={{
          status: loja.assinatura_status,
          inicio: loja.assinatura_inicio,
          fimPeriodo: loja.assinatura_fim_periodo,
        }}
        plano={planoAtual}
      />

      <GerenciarAssinaturaClient
        planos={planosView}
        planoAtualId={loja.plano_id}
        temAssinatura={temAssinatura}
      />

      <TabelaFaturas faturas={faturas} />
    </main>
  );
}
