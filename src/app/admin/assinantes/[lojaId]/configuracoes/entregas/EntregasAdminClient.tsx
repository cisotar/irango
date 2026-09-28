"use client";

import { EntregasClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";

import {
  salvarFaixasEntregaAdmin,
  salvarModalidadesEntregaAdmin,
} from "@/app/admin/assinantes/actions/admin-entrega";

/**
 * Wrapper admin fino da sub-rota de Entregas (issue 152). Reusa o
 * `EntregasClient` do painel (097) e INJETA as actions admin (094; faixas em
 * lote na issue 326) com o `lojaId` da URL fixado por closure.
 *
 * A autoridade (geocoding, taxa, escopo cross-loja) é das actions no servidor. A
 * taxa gravada aqui é definição comercial — o valor cobrado ao cliente segue
 * recalculado no checkout (`criar_pedido`); esta rota não introduz recálculo.
 */
export function EntregasAdminClient({
  lojaId,
  zonas,
  modalidades,
  taxaForaZona,
}: {
  lojaId: string;
  zonas: ZonaVitrine[];
  modalidades: DadosModalidadesEntrega;
  taxaForaZona: number | null;
}) {
  return (
    <EntregasClient
      zonas={zonas}
      modalidades={modalidades}
      taxaForaZona={taxaForaZona}
      acoes={{
        salvarModalidades: (payload) => salvarModalidadesEntregaAdmin(lojaId, payload),
        salvarFaixas: (payload) => salvarFaixasEntregaAdmin(lojaId, payload),
      }}
    />
  );
}
