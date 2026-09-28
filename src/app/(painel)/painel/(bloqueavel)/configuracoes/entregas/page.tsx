import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarZonasComTaxas } from "@/lib/supabase/queries/entregaPagamento";
import {
  salvarFaixasEntrega,
  salvarModalidadesEntrega,
} from "@/lib/actions/entrega";
import { modalidadesDaLoja } from "@/lib/utils/modalidadesEntrega";
import { EntregasClient } from "./EntregasClient";

/**
 * Página de zonas de entrega (issue 046). Server Component.
 *
 * Lista as zonas do dono (com taxa 1:1 e bairros 1:N) via client AUTENTICADO
 * (RLS `zonas_escrita_propria`/leitura própria). Sem loja → onboarding. As zonas
 * abrem como tabela de faixas de km (issue 326) e são gravadas em lote por
 * `salvarFaixasEntrega`, que deriva `loja_id` do dono.
 */
export default async function EntregasPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const zonas = await listarZonasComTaxas(supabase, loja.id);

  return (
    <EntregasClient
      zonas={zonas}
      modalidades={modalidadesDaLoja(loja)}
      taxaForaZona={loja.taxa_entrega_fora_zona}
      // Actions do LOJISTA passadas explicitamente (issue 160): `acoes` é
      // obrigatória, sem default — a via admin injeta as variantes por `lojaId`.
      acoes={{
        salvarModalidades: salvarModalidadesEntrega,
        salvarFaixas: salvarFaixasEntrega,
      }}
    />
  );
}
