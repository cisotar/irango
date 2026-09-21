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
import { ancoraSecao, idNaSecao } from "@/lib/utils/ancoraCategoria";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type {
  ProdutoVitrine,
  SecaoVitrine,
} from "@/lib/utils/catalogoVitrine";
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
  /**
   * [263/D16] As seções do catálogo, na ordem de render: as de DESTAQUE
   * (cardápio aberto) primeiro, depois as de categoria. `SecaoVitrine` é
   * `CategoriaComProdutos` + `tipo` — **um campo a mais, não um tipo novo**:
   * a seção de categoria continua sendo exatamente o objeto de antes, e o laço
   * de render não mudou de forma. Só quem produz a âncora mudou (RN-16).
   */
  secoes: SecaoVitrine[];
  /**
   * Mapa categoria_id (de produto) → grupos de opcional disponíveis (SSR, 081).
   * Produto sem categoria ou sem associação → sem opcionais no modal.
   */
  opcionaisPorCategoria?: Record<string, GrupoOpcional[]>;
  /**
   * [262/RN-06] Mapa `produto_id → frase de "quando volta"`, produzido pelo
   * MESMO `projetarCatalogoVitrine` que produziu os produtos (247/254): não
   * existe caminho de código que marque o produto sem produzir o rótulo dele.
   *
   * OBRIGATÓRIA de propósito (design §4.1, consequência 1): sem jsdom, o `tsc`
   * é a única trava contra alguém montar o catálogo sem os rótulos e a vitrine
   * degradar em silêncio para "Indisponível no momento".
   *
   * Chaveado por id ⇒ imune ao filtro da busca, exatamente como
   * `opcionaisPorCategoria` nesta mesma cadeia.
   */
  rotulosVigencia: Record<string, string>;
  /**
   * [263/D16/design §13.1] `cardapio_id → rótulo de janela` (`Até domingo`,
   * `Hoje, até as 15:00`, `Hoje`), redigido no SERVIDOR por
   * `rotuloJanelaDestaque` (M6) — nunca uma quarta redação de calendário
   * escrita aqui dentro.
   *
   * Ausente ⇒ o cabeçalho mostra só o nome do lojista. Falta de rótulo omite
   * um complemento; nunca inventa uma janela nem esconde um estado.
   */
  rotulosJanela?: Record<string, string>;
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

// [263/design §13.1 item 1] UMA constante para as duas espécies de seção: a de
// destaque usa literalmente a mesma grade da de categoria, e não uma cópia que
// possa divergir num `md:` daqui a três issues. Nunca carrossel nem scroll
// horizontal (design-system §9).
const CLASSES_GRADE =
  "grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

export function SecaoCatalogo({
  secoes,
  opcionaisPorCategoria = {},
  rotulosVigencia,
  rotulosJanela = {},
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
      // O modal é o único lugar onde a frase de vigência cabe inteira (§4.2).
      rotuloIndisponivel: rotulosVigencia[produto.id],
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
        // (238/RN-12-a) O que a VITRINE MOSTROU: só aqui existe essa
        // informação — o carrinho guarda o preço efetivo e não saberia dizer
        // se ele veio de promoção. É a origem de `promocaoExibida` no payload,
        // e sem ela a trava do servidor nunca dispara.
        ...(produtoSelecionado.temDesconto ? { temDesconto: true } : {}),
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
      {secoes.map((secao, indice) => {
        // Âncora derivada UMA vez por seção, aqui: é a mesma string que vai
        // para o `id` da <section>, para o `href` do chip (via `ancoraSecao` em
        // `NavCategorias`) e para o escopo do id de cada card (RN-16).
        const ancora = ancoraSecao(secao, indice);
        const rotuloJanela =
          secao.tipo === "cardapio" && secao.id !== null
            ? rotulosJanela[secao.id]
            : undefined;
        return (
        <section
          key={ancora}
          id={ancora}
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
            {/* O nome do lojista, SEM prefixo (design §13.1 item 2): nada de
                "Cardápio: Cardápio de Inverno" — o lojista já nomeia. E sem
                `TextoRealcado`: a busca não alcança o destaque (RN-16). */}
            <h2 className="text-base font-bold tracking-widest whitespace-nowrap text-marrom-cafe uppercase">
              {secao.nome}
            </h2>
            {/* O ÚNICO texto que o cabeçalho acrescenta (design §13.1 item 3):
                a seção some sozinha quando o cardápio fecha, e sem o rótulo o
                cliente que voltar às 15:01 acharia que aquilo foi um erro. */}
            {rotuloJanela ? (
              <span className="whitespace-nowrap text-xs font-semibold text-texto-muted normal-case">
                {rotuloJanela}
              </span>
            ) : null}
            <span
              aria-hidden
              className="h-0.5 flex-1 bg-[linear-gradient(90deg,transparent,var(--marrom-cafe),transparent)]"
            />
          </div>
          {/* A seção de destaque nunca tem `exibir_imagens` (não é de categoria
              nenhuma) ⇒ cai no grid. O produto de categoria "ocultar" aparece
              ali SEM FOTO, com o placeholder de gradiente do próprio card: a
              `foto_url` já veio `null` do servidor, por produto (248/RN-06). */}
          {secao.exibir_imagens === false ? (
            <div className="overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
              {/* `ItemProdutoLista` NÃO recebe id de DOM — e não pode ganhar um
                  que não seja escopado pela seção (RN-16). */}
              {secao.produtos.map((produto) => (
                <ItemProdutoLista
                  key={produto.id}
                  produto={produto}
                  termo={termo}
                  rotuloIndisponivel={rotulosVigencia[produto.id]}
                  onSelecionar={() => abrirModal(produto)}
                />
              ))}
            </div>
          ) : (
            <div className={CLASSES_GRADE}>
              {secao.produtos.map((produto) => (
                <CardProduto
                  // `key` continua sendo `produto.id`: chave só precisa ser
                  // única ENTRE IRMÃOS, e cada seção tem seu próprio laço.
                  // Trocá-la por uma composta remontaria o card à toa (RN-16).
                  key={produto.id}
                  produto={produto}
                  idNaSecao={idNaSecao(ancora, produto.id)}
                  termo={termo}
                  rotuloIndisponivel={rotulosVigencia[produto.id]}
                  // Em vez de adicionar direto, abre o modal de detalhe do produto.
                  onAdicionar={() => abrirModal(produto)}
                />
              ))}
            </div>
          )}
        </section>
        );
      })}

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
