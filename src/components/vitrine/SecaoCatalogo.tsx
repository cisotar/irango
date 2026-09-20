"use client";

import { useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { CardProduto } from "@/components/vitrine/CardProduto";
import { ItemProdutoLista } from "@/components/vitrine/ItemProdutoLista";
import {
  ProdutoModal,
  type ProdutoModalDados,
} from "@/components/vitrine/ProdutoModal";
import { useCarrinho } from "@/hooks/useCarrinho";
import { ancoraCategoria } from "@/lib/utils/ancoraCategoria";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import type { OpcionalCarrinho } from "@/types/dominio";

/** Uma categoria (ou "Outros") com seus produtos disponíveis. */
export type CategoriaComProdutos = {
  id: string | null;
  nome: string;
  /**
   * Preferência de imagem da categoria (SSR — categorias.exibir_imagens).
   * `true`/ausente (grupo "Outros", sem categoria) → grid de `CardProduto`
   * (comportamento atual). `false` → lista textual (`ItemProdutoLista`), sem
   * imagem/placeholder (specs/toggle-imagens-por-categoria.md, RN-3/RN-5).
   * Decisão já resolvida no servidor — aqui só espelha, sem toggle client-side.
   */
  exibir_imagens?: boolean;
  /**
   * Contrato de catálogo (224/225): o objeto INTEIRO, produzido no servidor.
   * Não existe mais shape reduzido nem campo com default — é essa troca que
   * torna o D13 impossível de reintroduzir.
   */
  produtos: ProdutoVitrine[];
};

type SecaoCatalogoProps = {
  categorias: CategoriaComProdutos[];
  /**
   * Mapa categoria_id (de produto) → grupos de opcional disponíveis (SSR, 081).
   * Produto sem categoria ou sem associação → sem opcionais no modal.
   */
  opcionaisPorCategoria?: Record<string, GrupoOpcional[]>;
  /**
   * Termo de busca ativo (200), repassado a cada card/linha para realçar o
   * trecho casado. Ausente/vazio → catálogo renderiza exatamente como antes.
   * O filtro em si é de quem monta `categorias` (`filtrarCatalogo`, 199/202).
   */
  termo?: string;
};

/**
 * Catálogo da vitrine: seções por categoria, renderizadas como grid de
 * `CardProduto` (exibir_imagens true/ausente) ou lista textual de
 * `ItemProdutoLista` (exibir_imagens false) — escolha feita a partir do dado
 * já resolvido no servidor (specs/toggle-imagens-por-categoria.md, RN-3). É
 * client porque o clique de cada card/linha abre o `ProdutoModal` (estado de
 * UX no client) e a confirmação sobe para `useCarrinho().adicionar`.
 * Preço/subtotal são preview — o servidor recalcula valores no checkout
 * (seguranca.md §10).
 */

// Achado acelerar/201: objeto literal inline em `style` é realocado a cada
// render da `<section>` — hoisted para módulo porque a 202 vai re-renderizar
// por categoria a cada tecla digitada na busca.
const ESTILO_ANCORA_CATEGORIA: CSSProperties = {
  scrollMarginTop: "calc(var(--altura-barra) + 0.75rem)",
};

export function SecaoCatalogo({
  categorias,
  opcionaisPorCategoria = {},
  termo,
}: SecaoCatalogoProps) {
  const { adicionar } = useCarrinho();
  const [produtoSelecionado, setProdutoSelecionado] =
    useState<ProdutoModalDados | null>(null);
  const [modalAberto, setModalAberto] = useState(false);

  // Repassa o `ProdutoVitrine` INTEIRO — nunca mais um objeto remontado campo a
  // campo. Era a remontagem parcial que deixava comprabilidade (e agora preço
  // efetivo) caírem no chão em silêncio no caminho do modal (D13).
  const abrirModal = (produto: ProdutoVitrine) => {
    setProdutoSelecionado({
      ...produto,
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
    // Observação da linha (168): repassada crua — `adicionar` canoniza antes de
    // guardar, e é o texto canônico que entra na chave de dedup da linha.
    observacao?: string,
  ) => {
    if (!produtoSelecionado || produtoSelecionado.id !== produtoId) return;
    adicionar(
      {
        produtoId: produtoSelecionado.id,
        nome: produtoSelecionado.nome,
        // PREVIEW do carrinho: o preço EFETIVO, a mesma fonte que alimenta o
        // subtotal do modal — senão o preview do carrinho divergiria do preview
        // do modal em todo produto em promoção. Autoritativo é o recálculo do
        // servidor a partir do banco (seguranca.md §10).
        preco: produtoSelecionado.precoEfetivo,
        fotoUrl: fotoSegura(produtoSelecionado.foto_url) ?? undefined,
        ...(opcionais.length > 0 ? { opcionais } : {}),
        ...(observacao ? { observacao } : {}),
      },
      quantidade,
    );
    toast.success(
      quantidade > 1
        ? `${quantidade}x ${produtoSelecionado.nome} adicionado ao carrinho.`
        : `${produtoSelecionado.nome} adicionado ao carrinho.`,
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {categorias.map((categoria, indice) => (
        <section
          key={ancoraCategoria(categoria.id, indice)}
          id={ancoraCategoria(categoria.id, indice)}
          // Deslocamento da âncora = altura MEDIDA da barra sticky da vitrine
          // (`--altura-barra`, publicada por CatalogoVitrine) + a folga do
          // mockup. Inline, e não classe Tailwind arbitrária: um `_` esquecido
          // no escape geraria classe inválida em silêncio — o exato modo de
          // falha que a issue 201 existe para eliminar. Valor fixo é proibido
          // (RN-6): a antiga classe fixa de scroll-margin (6rem) só não
          // incomodava porque não havia barra nenhuma sobre a qual compensar.
          style={ESTILO_ANCORA_CATEGORIA}
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
          {categoria.exibir_imagens === false ? (
            <div className="overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
              {categoria.produtos.map((produto) => (
                <ItemProdutoLista
                  key={produto.id}
                  produto={produto}
                  termo={termo}
                  onSelecionar={() => abrirModal(produto)}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {categoria.produtos.map((produto) => (
                <CardProduto
                  key={produto.id}
                  produto={produto}
                  termo={termo}
                  // Em vez de adicionar direto, abre o modal de detalhe do produto.
                  onAdicionar={() => abrirModal(produto)}
                />
              ))}
            </div>
          )}
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
