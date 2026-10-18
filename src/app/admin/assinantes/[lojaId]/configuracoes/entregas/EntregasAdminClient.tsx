"use client";

import { EntregasClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";
import type { FormaFrete } from "@/lib/utils/formaFrete";

import {
  definirFormaFreteAdmin,
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
 * Mostra a mesma tela do lojista (seletor de forma e botão "Usar esta forma",
 * issue 325); das coordenadas
 * da loja recebe só o boolean `temCoordenadas` (327).
 */
export function EntregasAdminClient({
  lojaId,
  zonas,
  forma,
  versao,
  temCoordenadas,
  hrefPerfil,
  modalidades,
  taxaForaZona,
}: {
  lojaId: string;
  zonas: ZonaVitrine[];
  forma: FormaFrete;
  versao: number;
  temCoordenadas: boolean;
  hrefPerfil: string;
  modalidades: DadosModalidadesEntrega;
  taxaForaZona: number | null;
}) {
  return (
    <EntregasClient
      zonas={zonas}
      forma={forma}
      versao={versao}
      temCoordenadas={temCoordenadas}
      hrefPerfil={hrefPerfil}
      modalidades={modalidades}
      taxaForaZona={taxaForaZona}
      acoes={{
        salvarModalidades: (payload) => salvarModalidadesEntregaAdmin(lojaId, payload),
        salvarZonas: (payload) => salvarZonasEntregaAdmin(lojaId, payload),
        definirForma: (payload) => definirFormaFreteAdmin(lojaId, payload),
      }}
    />
  );
}
