"use client";

import { EntregasClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";

import {
  criarZonaAdmin,
  atualizarZonaAdmin,
  removerZonaAdmin,
  alternarZonaAtivaAdmin,
  salvarModalidadesEntregaAdmin,
} from "@/app/admin/assinantes/actions/admin-entrega";

/**
 * Wrapper admin fino da sub-rota de Entregas (issue 152). Reusa o
 * `EntregasClient` do painel (097) e INJETA as actions admin de zona (094) com o
 * `lojaId` da URL fixado por closure.
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
        criarZona: (payload) => criarZonaAdmin(lojaId, payload),
        atualizarZona: (id, payload) => atualizarZonaAdmin(lojaId, id, payload),
        removerZona: (id) => removerZonaAdmin(lojaId, id),
        alternarZonaAtiva: (id, ativo) =>
          alternarZonaAtivaAdmin(lojaId, id, ativo),
      }}
    />
  );
}
