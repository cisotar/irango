"use client";

import { useState } from "react";

import { CardProduto } from "@/components/vitrine/CardProduto";
import {
  ProdutoModal,
  type ProdutoModalDados,
} from "@/components/vitrine/ProdutoModal";
import { useCarrinho } from "@/hooks/useCarrinho";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type { OpcionalCarrinho } from "@/types/dominio";

/** Produto no shape que a vitrine renderiza (subconjunto de produtos). */
export type ProdutoCatalogo = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  foto_url: string | null;
  /** Categoria de produto — usada para resolver os opcionais (issue 087). */
  categoria_id: string | null;
};

/** Uma categoria (ou "Outros") com seus produtos disponíveis. */
export type CategoriaComProdutos = {
  id: string | null;
  nome: string;
  produtos: ProdutoCatalogo[];
};

type SecaoCatalogoProps = {
  categorias: CategoriaComProdutos[];
  /**
   * Mapa categoria_id (de produto) → grupos de opcional disponíveis (SSR, 081).
   * Produto sem categoria ou sem associação → sem opcionais no modal.
   */
  opcionaisPorCategoria?: Record<string, GrupoOpcional[]>;
};

/** Slug-âncora estável por grupo (categorias têm id; "Outros" não). */
function ancora(id: string | null, indice: number): string {
  return id ? `cat-${id}` : `grupo-${indice}`;
}

/**
 * Catálogo da vitrine: seções por categoria com grid de `CardProduto`. É client
 * porque o clique de cada card abre o `ProdutoModal` (estado de UX no client) e a
 * confirmação sobe para `useCarrinho().adicionar`. Preço/subtotal são preview — o
 * servidor recalcula valores no checkout (seguranca.md §10).
 */
export function SecaoCatalogo({
  categorias,
  opcionaisPorCategoria = {},
}: SecaoCatalogoProps) {
  const { adicionar } = useCarrinho();
  const [produtoSelecionado, setProdutoSelecionado] =
    useState<ProdutoModalDados | null>(null);
  const [modalAberto, setModalAberto] = useState(false);

  const abrirModal = (produto: ProdutoCatalogo) => {
    setProdutoSelecionado({
      id: produto.id,
      nome: produto.nome,
      descricao: produto.descricao,
      preco: produto.preco,
      fotoUrl: produto.foto_url,
      gruposOpcionais: produto.categoria_id
        ? opcionaisPorCategoria[produto.categoria_id]
        : undefined,
    });
    setModalAberto(true);
  };

  // Confirmação do modal: adiciona a quantidade + opcionais escolhidos ao carrinho.
  // Os opcionais carregam preço só como PREVIEW (o servidor recalcula — §10).
  const confirmarAdicao = (
    produtoId: string,
    quantidade: number,
    opcionais: OpcionalCarrinho[],
  ) => {
    if (!produtoSelecionado || produtoSelecionado.id !== produtoId) return;
    adicionar(
      {
        produtoId: produtoSelecionado.id,
        nome: produtoSelecionado.nome,
        preco: produtoSelecionado.preco,
        fotoUrl: fotoSegura(produtoSelecionado.fotoUrl) ?? undefined,
        ...(opcionais.length > 0 ? { opcionais } : {}),
      },
      quantidade,
    );
  };

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
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
            {categoria.produtos.map((produto) => (
              <CardProduto
                key={produto.id}
                id={produto.id}
                nome={produto.nome}
                descricao={produto.descricao}
                preco={produto.preco}
                fotoUrl={produto.foto_url}
                // Em vez de adicionar direto, abre o modal de detalhe do produto.
                onAdicionar={() => abrirModal(produto)}
              />
            ))}
          </div>
        </section>
      ))}

      <ProdutoModal
        key={produtoSelecionado?.id ?? "vazio"}
        produto={produtoSelecionado}
        open={modalAberto}
        onOpenChange={setModalAberto}
        onAdicionar={confirmarAdicao}
      />
    </div>
  );
}
