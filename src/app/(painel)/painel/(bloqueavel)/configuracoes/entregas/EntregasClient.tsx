"use client";

import { ModalidadesEntrega } from "@/components/painel/ModalidadesEntrega";
import { TabelaFaixasEntrega } from "@/components/painel/TabelaFaixasEntrega";
import type {
  salvarFaixasEntrega as salvarFaixasLojista,
  salvarModalidadesEntrega as salvarModalidadesLojista,
} from "@/lib/actions/entrega";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";

export type EntregasClientProps = {
  zonas: ZonaVitrine[];
  /** Modalidades GRAVADAS da loja (spec modalidades-entrega-loja). */
  modalidades: DadosModalidadesEntrega;
  /** `lojas.taxa_entrega_fora_zona` — aviso D4 das modalidades e copy do limite (326, D7). */
  taxaForaZona: number | null;
  /**
   * Actions injetadas. OBRIGATÓRIAS (issue 160): a page do painel passa as do
   * lojista, a via admin passa as variantes escopadas por `lojaId`. Sem default —
   * omitir uma prop aqui quebra o build em vez de gravar na loja errada.
   */
  acoes: {
    salvarModalidades: typeof salvarModalidadesLojista;
    salvarFaixas: typeof salvarFaixasLojista;
  };
};

export function EntregasClient({
  zonas,
  modalidades,
  taxaForaZona,
  acoes,
}: EntregasClientProps) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <ModalidadesEntrega
        inicial={modalidades}
        zonas={zonas}
        taxaForaZona={taxaForaZona}
        salvar={acoes.salvarModalidades}
      />

      <h1 className="mb-2 font-heading text-xl font-semibold text-foreground">
        Zonas de entrega
      </h1>
      {/* As zonas ficam guardadas mesmo quando não são usadas: religar a
          entrega ou voltar ao frete calculado não exige recadastrar nada. */}
      <p className="mb-6 text-sm text-muted-foreground">
        {!modalidades.aceita_entrega
          ? "A entrega está desligada. As zonas ficam guardadas para quando você religar."
          : modalidades.modo_frete === "a_combinar"
            ? "O frete está sendo combinado no WhatsApp. As zonas ficam guardadas para quando você voltar ao frete calculado."
            : "O frete de cada pedido é calculado por estas zonas."}
      </p>

      {/* Issue 326: tabela de faixas de km substitui a lista de zonas e o form de zona. */}
      <TabelaFaixasEntrega
        zonas={zonas}
        taxaForaZona={taxaForaZona}
        salvar={acoes.salvarFaixas}
      />
    </main>
  );
}
