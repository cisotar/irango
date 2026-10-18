import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarZonasParaEdicao } from "@/lib/supabase/queries/entregaPagamento";
import {
  salvarModalidadesEntrega,
  salvarZonasEntrega,
} from "@/lib/actions/entrega";
import { modalidadesDaLoja } from "@/lib/utils/modalidadesEntrega";
import { EntregasClient } from "./EntregasClient";

/**
 * Página de zonas de entrega (issue 046). Server Component.
 *
 * Lê as zonas do dono (com taxa 1:1 e bairros 1:N) junto da versão otimista
 * (`listarZonasParaEdicao`, um select só) via client AUTENTICADO (RLS
 * `zonas_escrita_propria`/leitura própria). Sem loja → onboarding. As zonas
 * abrem como tabela de faixas de km (issue 326) e são gravadas por
 * `salvarZonasEntrega`, que deriva `loja_id` do dono e confere a versão.
 */
export default async function EntregasPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel");
  }

  const { versao, zonas } = await listarZonasParaEdicao(supabase, loja.id);

  return (
    <EntregasClient
      zonas={zonas}
      versao={versao}
      modalidades={modalidadesDaLoja(loja)}
      taxaForaZona={loja.taxa_entrega_fora_zona}
      // Actions do LOJISTA passadas explicitamente (issue 160): `acoes` é
      // obrigatória, sem default — a via admin injeta as variantes por `lojaId`.
      acoes={{
        salvarModalidades: salvarModalidadesEntrega,
        salvarZonas: salvarZonasEntrega,
      }}
    />
  );
}
