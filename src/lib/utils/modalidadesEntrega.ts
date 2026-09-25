// Disponibilidade das modalidades de entrega (spec modalidades-entrega-loja).
// Função PURA, fonte única da regra lida por dois lados: a vitrine (esconde a
// modalidade indisponível) e o painel de Entregas (aviso D4). O servidor do
// pedido (`criarPedido`) continua sendo a autoridade: relê a loja e recusa a
// modalidade desligada.
//
// Colunas ausentes (`undefined`/`null`) valem o default da migration — as duas
// ligadas e frete automático, que é o comportamento anterior à feature.

import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";

type LojaModalidades = {
  aceita_entrega?: boolean | null;
  aceita_retirada?: boolean | null;
  modo_frete?: string | null;
  taxa_entrega_fora_zona?: number | null;
};

type ZonaResumo = { ativo: boolean; taxa: unknown | null };

/**
 * Entrega disponível na vitrine = ligada pela loja E (frete a combinar, que
 * dispensa zona, OU zona ativa com taxa OU fallback fora-de-zona). Ligada em
 * modo automático sem zona e sem fallback fica indisponível (D4, RN-C4).
 */
export function entregaDisponivel(loja: LojaModalidades, zonas: ZonaResumo[]): boolean {
  if (loja.aceita_entrega === false) return false;
  if (loja.modo_frete === "a_combinar") return true;
  return (
    zonas.some((z) => z.ativo && z.taxa !== null) || loja.taxa_entrega_fora_zona != null
  );
}

export function retiradaDisponivel(loja: LojaModalidades): boolean {
  return loja.aceita_retirada !== false;
}

/**
 * Linha de `lojas` → estado inicial do form de modalidades. `modo_frete` é
 * `text` no banco (CHECK), então o valor é estreitado aqui para o enum.
 */
export function modalidadesDaLoja(loja: LojaModalidades): DadosModalidadesEntrega {
  return {
    aceita_retirada: retiradaDisponivel(loja),
    aceita_entrega: loja.aceita_entrega !== false,
    modo_frete: loja.modo_frete === "a_combinar" ? "a_combinar" : "automatico",
  };
}
