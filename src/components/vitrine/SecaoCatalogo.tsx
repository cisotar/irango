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
          <h2 className="mb-4 text-xl font-bold text-marrom-cafe">
            {categoria.nome}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
