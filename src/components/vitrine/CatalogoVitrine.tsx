"use client";

import { useLayoutEffect, useRef } from "react";

import {
  SecaoCatalogo,
  type CategoriaComProdutos,
} from "@/components/vitrine/SecaoCatalogo";
import {
  CLASSES_MAIN_VITRINE,
  ESCADA_LARGURA_VITRINE,
} from "@/components/vitrine/layoutVitrine";
import {
  VAR_ALTURA_BARRA,
  medirEObservarBarra,
} from "@/components/vitrine/medicaoBarraVitrine";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";

type CatalogoVitrineProps = {
  categorias: CategoriaComProdutos[];
  opcionaisPorCategoria?: Record<string, GrupoOpcional[]>;
};

/**
 * Dono do layout do catálogo na vitrine: a barra sticky (slots da busca da 202
 * e da nav de categorias da 203), a medição dessa barra em runtime e o `<main>`
 * que envolve o `SecaoCatalogo`.
 *
 * É a única camada client com estado de layout da vitrine — busca, nav e
 * catálogo precisam do mesmo `termo`, e três irmãos sob um Server Component não
 * têm onde compartilhá-lo. Nenhuma invariante de valor ou de permissão vive
 * aqui: o conjunto de produtos vem do SSR sob `anon` + RLS (RN-1) e o preço é
 * recalculado no checkout (seguranca.md §10).
 */
export function CatalogoVitrine({
  categorias,
  opcionaisPorCategoria,
}: CatalogoVitrineProps) {
  const barraRef = useRef<HTMLDivElement>(null);
  const temBarra = categorias.length > 0;

  // Altura REAL da barra, medida antes do paint e republicada a cada resize
  // (rotação, quebra de linha, troca trilho↔resumo da 202). Valor fixo é
  // proibido (RN-6): os 6rem da antiga classe fixa de scroll-margin só não
  // quebravam porque não havia barra. `useLayoutEffect` direto — o aviso de
  // SSR do React não existe mais desde facebook/react#26395 (projeto em
  // react 19).
  //
  // Mecânica extraída para `medicaoBarraVitrine.ts` (módulo neutro, testado em
  // `environment: node` com fakes injetados) — aqui só o fio com o DOM real.
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    const barra = barraRef.current;
    if (!barra) {
      raiz.style.removeProperty(VAR_ALTURA_BARRA);
      return;
    }
    return medirEObservarBarra(barra, {
      raiz,
      ResizeObserverCtor:
        typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
    });
  }, [temBarra]);

  return (
    <>
      {temBarra ? (
        <div
          ref={barraRef}
          className="sticky top-0 z-30 border-b border-borda-nav bg-[var(--cor-fundo)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
        >
          <div className={ESCADA_LARGURA_VITRINE}>
            {/* 202: <BuscaProdutos/> — o slot traz o próprio `px-4 pt-3 pb-2`. */}
            {/* 203: <NavCategorias/> — o slot traz o próprio `px-4 pb-2.5`. */}
            {/* A barra NÃO tem padding vertical próprio: com os slots vazios
                ela mede 1px (só a borda) e a vitrine fica igual à de hoje. */}
          </div>
        </div>
      ) : null}

      <main className={CLASSES_MAIN_VITRINE}>
        <SecaoCatalogo
          categorias={categorias}
          opcionaisPorCategoria={opcionaisPorCategoria}
        />
      </main>
    </>
  );
}
