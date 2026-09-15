"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { NavCategorias } from "@/components/vitrine/NavCategorias";
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
  // Altura medida da barra, em px. NÃO é usada como valor aqui: só desce para
  // `NavCategorias` como GATILHO de reconstrução do observer (o `rootMargin` é
  // congelado no construtor do IntersectionObserver). `aoMedir` só dispara
  // quando a altura MUDA de verdade — montagem, rotação, troca trilho↔resumo
  // (202) — nunca por scroll ou tecla digitada, então não há loop de render.
  const [alturaBarra, setAlturaBarra] = useState(0);

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
      aoMedir: setAlturaBarra,
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
            {/* A barra NÃO tem padding vertical próprio: cada slot traz o seu.
                A nav some sozinha com menos de 3 categorias (RN-4) e a 202 vai
                DESMONTÁ-LA (não ocultá-la) quando o termo de busca não for
                vazio — desmontar é o que desconecta o observer e impede que ele
                siga observando <section> que a filtragem tirou do DOM. */}
            <NavCategorias categorias={categorias} alturaBarra={alturaBarra} />
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
