"use client";

import { EntregasClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";

import {
  salvarModalidadesEntregaAdmin,
  salvarZonasEntregaAdmin,
} from "@/app/admin/assinantes/actions/admin-entrega";

/**
 * Wrapper admin fino da sub-rota de Entregas (issue 152). Reusa o
 * `EntregasClient` do painel (097) e INJETA as actions admin (094; zonas numa
 * forma só com versão otimista nas issues 325/328) com o `lojaId` da URL fixado por closure.
 *
 * A autoridade (geocoding, taxa, escopo cross-loja) é das actions no servidor. A
 * taxa gravada aqui é definição comercial — o valor cobrado ao cliente segue
 * recalculado no checkout (`criar_pedido`); esta rota não introduz recálculo.
 */
export function EntregasAdminClient({
  lojaId,
  zonas,
  versao,
  modalidades,
  taxaForaZona,
}: {
  lojaId: string;
  zonas: ZonaVitrine[];
  versao: number;
  modalidades: DadosModalidadesEntrega;
  taxaForaZona: number | null;
}) {
  return (
    <EntregasClient
      zonas={zonas}
      versao={versao}
      modalidades={modalidades}
      taxaForaZona={taxaForaZona}
      acoes={{
        salvarModalidades: (payload) => salvarModalidadesEntregaAdmin(lojaId, payload),
        salvarZonas: (payload) => salvarZonasEntregaAdmin(lojaId, payload),
      }}
    />
  );
}
