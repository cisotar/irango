"use client";

import type { ReactElement } from "react";

import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type { OcultacoesOpcionais } from "@/components/painel/useOcultacoesOpcionais";

export type PilulasOpcionaisDoProdutoProps = {
  produtoId: string;
  produtoNome: string;
  /** Grupos herdados da categoria do produto — TODOS, inclusive os ocultos nele. */
  grupos: readonly Pick<GrupoOpcional, "categoriaOpcionalId" | "categoriaOpcionalNome" | "ordem">[];
  /** A instância única da tela (`useOcultacoesOpcionais`): lê e grava por ela. */
  ocultacoes: Pick<OcultacoesOpcionais, "oculto" | "alternar">;
  /** `card`: linha do produto na lista. `form`: seção do modal de edição. */
  variante: "card" | "form";
};

/**
 * [331] As pílulas de grupos de opcionais de UM produto, clicáveis: cada uma
 * exibe/oculta o grupo herdado da categoria só neste produto. Substitui o
 * `Badge` estático da linha do `ProdutosClient` e é a mesma peça da seção
 * "Adicionais deste produto" do `FormProduto` — uma fonte, duas vistas.
 *
 * Só apresentação: "está oculto?" é `ocultacoes.oculto` e gravar é
 * `ocultacoes.alternar` (otimista, reverte e anuncia em falha). Nenhuma regra
 * aqui; a autoridade é o servidor (o pedido recusa grupo oculto).
 *
 * Estado em três sinais, nunca só cor (design-system §5): `aria-pressed`
 * (`true` = aparece), o nome riscado/esmaecido e a palavra "oculto".
 * Alvo de 44px literal com a pílula desenhada menor dentro, como em
 * `PilulasDeDias` — alvo de toque é a área que recebe o toque.
 */
export function PilulasOpcionaisDoProduto({
  produtoId,
  produtoNome,
  grupos,
  ocultacoes,
  variante,
}: PilulasOpcionaisDoProdutoProps): ReactElement | null {
  if (grupos.length === 0) return null;

  // Ordem da categoria (a mesma da vitrine); `slice` para não mutar a prop.
  const ordenados = grupos.slice().sort((a, b) => a.ordem - b.ordem);
  const noForm = variante === "form";

  return (
    <ul
      className={noForm ? "flex flex-wrap gap-x-2" : "mt-0.5 flex flex-wrap gap-x-1.5"}
      aria-label={`Grupos de opcionais de ${produtoNome}`}
    >
      {ordenados.map((g) => {
        const oculto = ocultacoes.oculto(produtoId, g.categoriaOpcionalId);
        const desenho = oculto
          ? "border-dashed border-border bg-background text-muted-foreground group-hover:bg-muted"
          : "border-transparent bg-secondary text-secondary-foreground group-hover:bg-secondary/70";
        return (
          <li key={g.categoriaOpcionalId}>
            <button
              type="button"
              aria-pressed={!oculto}
              // Rótulo estável: o estado é do `aria-pressed`, não do nome.
              aria-label={`Exibir ${g.categoriaOpcionalNome} em ${produtoNome}`}
              onClick={() => void ocultacoes.alternar(produtoId, g.categoriaOpcionalId)}
              className="group grid min-h-[44px] min-w-[44px] place-items-center rounded-full outline-none"
            >
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50 ${
                  noForm ? "h-[32px] text-sm" : "h-[28px] text-xs"
                } ${desenho}`}
              >
                <span className={oculto ? "line-through" : undefined}>
                  {g.categoriaOpcionalNome}
                </span>
                {oculto && <span>oculto</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
