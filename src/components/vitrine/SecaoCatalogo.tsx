"use client";

import { CardProduto } from "@/components/vitrine/CardProduto";
import { useCarrinho } from "@/hooks/useCarrinho";

/** Produto no shape que a vitrine renderiza (subconjunto de produtos). */
export type ProdutoCatalogo = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  foto_url: string | null;
};

/** Uma categoria (ou "Outros") com seus produtos disponíveis. */
export type CategoriaComProdutos = {
  id: string | null;
  nome: string;
  produtos: ProdutoCatalogo[];
};

type SecaoCatalogoProps = {
  categorias: CategoriaComProdutos[];
};

/** Slug-âncora estável por grupo (categorias têm id; "Outros" não). */
function ancora(id: string | null, indice: number): string {
  return id ? `cat-${id}` : `grupo-${indice}`;
}

/**
 * Catálogo da vitrine: seções por categoria com grid de `CardProduto`. É client
 * porque o `onAdicionar` de cada card sobe direto para `useCarrinho().adicionar`
 * (estado de UX no client; o servidor recalcula valores no checkout).
 */
export function SecaoCatalogo({ categorias }: SecaoCatalogoProps) {
  const { adicionar } = useCarrinho();

  return (
    <div className="flex flex-col gap-8">
      {categorias.map((categoria, indice) => (
        <section
          key={categoria.id ?? `grupo-${indice}`}
          id={ancora(categoria.id, indice)}
          className="scroll-mt-24"
        >
          {/* Título de seção: h2 em caixa-alta flanqueado por linhas-gradiente
              (design-claude/vitrine/titulo-secao.html). */}
          <div className="mb-4 flex items-center gap-3.5">
            <span
              aria-hidden
              className="h-0.5 flex-1 bg-[linear-gradient(90deg,transparent,var(--marrom-cafe),transparent)]"
            />
            <h2 className="text-base font-bold tracking-widest whitespace-nowrap text-marrom-cafe uppercase">
              {categoria.nome}
            </h2>
            <span
              aria-hidden
              className="h-0.5 flex-1 bg-[linear-gradient(90deg,transparent,var(--marrom-cafe),transparent)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            {categoria.produtos.map((produto) => (
              <CardProduto
                key={produto.id}
                id={produto.id}
                nome={produto.nome}
                descricao={produto.descricao}
                preco={produto.preco}
                fotoUrl={produto.foto_url}
                onAdicionar={() =>
                  adicionar({
                    produtoId: produto.id,
                    nome: produto.nome,
                    preco: produto.preco,
                    fotoUrl:
                      produto.foto_url &&
                      produto.foto_url.startsWith("https://")
                        ? produto.foto_url
                        : undefined,
                  })
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
