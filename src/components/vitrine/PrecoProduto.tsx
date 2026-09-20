import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { rotuloPrecoAcessivel } from "@/lib/utils/rotuloPrecoAcessivel";

type Tamanho = "card" | "lista" | "modal";

type PrecoProdutoProps = {
  /** Objeto do contrato de catálogo — nunca campos avulsos (M2). */
  produto: Pick<ProdutoVitrine, "preco" | "precoEfetivo" | "temDesconto">;
  /** OBRIGATÓRIO, sem default: esquecer quebra o `tsc`, não o layout. */
  tamanho: Tamanho;
};

/** Tamanho do preço que o cliente paga, por superfície (o que cada uma já usa). */
const PRECO: Record<Tamanho, string> = {
  card: "text-lg font-black lg:text-sm",
  lista: "text-sm font-extrabold",
  modal: "text-xs font-extrabold",
};

/** Preço de tabela riscado — sempre um degrau menor que o preço efetivo. */
const RISCADO: Record<Tamanho, string> = {
  card: "text-xs lg:text-[0.625rem]",
  lista: "text-xs",
  modal: "text-[0.625rem]",
};

/**
 * Direção do par por superfície (issue 233, design §3.2–§3.4). Em 168px de card
 * e numa linha de cardápio com nome + pontilhado os dois preços NÃO cabem lado a
 * lado: empilham (riscado em cima, efetivo embaixo). No modal há largura de
 * sobra e o par segue `Cada unidade · …` na mesma linha.
 *
 * Mora aqui, e não em cada consumidor, porque o par de preços é UM componente
 * (M1): a superfície escolhe `tamanho` e recebe escala + direção juntas.
 */
const CONTAINER: Record<Tamanho, string> = {
  card: "inline-flex flex-col items-start leading-tight [font-variant-numeric:tabular-nums]",
  lista:
    "inline-flex flex-col items-end text-right leading-tight [font-variant-numeric:tabular-nums]",
  modal: "inline-flex items-baseline gap-x-1.5 [font-variant-numeric:tabular-nums]",
};

/**
 * O par de preços da vitrine — a ÚNICA implementação de "preço riscado + preço
 * promocional" do projeto (M1). Apresentação pura: `preco`, `precoEfetivo` e
 * `temDesconto` chegam decididos do servidor e nada é recalculado aqui.
 *
 * Sem desconto (`temDesconto === false`) a árvore é a de hoje: um `<span>` só
 * com o preço efetivo, sem riscar nada e sem `sr-only` duplicado (o texto
 * visível já é o que o leitor de tela lê).
 *
 * Com desconto, o par visual inteiro é `aria-hidden` e a verdade acessível vira
 * uma frase só no `sr-only` — `<s>` não é anunciado pela maioria dos leitores
 * de tela, então sem isso o cliente cego ouviria dois preços sem saber qual
 * paga (design §3.1). Mesmo precedente do realce de busca em `CardProduto`.
 */
export function PrecoProduto({ produto, tamanho }: PrecoProdutoProps) {
  if (!produto.temDesconto) {
    return (
      <span className={`${CONTAINER[tamanho]} ${PRECO[tamanho]} text-destaque`}>
        {formatarMoeda(produto.precoEfetivo)}
      </span>
    );
  }

  return (
    <span className={CONTAINER[tamanho]}>
      <span className="sr-only">{rotuloPrecoAcessivel(produto)}</span>
      <s aria-hidden className={`${RISCADO[tamanho]} text-texto-muted`}>
        {formatarMoeda(produto.preco)}
      </s>
      <span aria-hidden className={`${PRECO[tamanho]} text-destaque`}>
        {formatarMoeda(produto.precoEfetivo)}
      </span>
    </span>
  );
}
