// Contrato de catálogo v1 — dono:
// `specs/desconto-por-produto-e-pratos-promocionais.md` §Contrato de catálogo.
// Produzido SEMPRE no servidor. Todo número monetário aqui já é autoritativo na
// origem; o que o cliente faz com ele depois é preview (seguranca.md §10).
import type { Tables } from "@/lib/database.types";
import { precoEfetivo, type ProdutoComDesconto } from "./precoEfetivo";

/**
 * Entrada da projeção. A spec escreveu `produto: Produto`, mas depois da issue
 * 265 a vitrine NÃO lê mais a tabela `produtos`: lê a view
 * `public.vitrine_produtos` e recebe `ProdutoPublico` (14 colunas). Exigir a row
 * inteira faria `projetarProdutoVitrine` recusar justamente o seu único caller
 * de vitrine. O tipo é ESTRUTURAL e mínimo: o que a projeção realmente lê —
 * satisfeito por `ProdutoPublico` (view) e por `Produto` (tabela, recálculo).
 */
export type ProdutoParaVitrine = ProdutoComDesconto &
  Pick<
    Tables<"produtos">,
    "id" | "nome" | "descricao" | "foto_url" | "categoria_id" | "disponivel"
  >;

export type ProdutoVitrine = {
  // ── identidade e apresentação ──────────────────────────────────────────────
  id: string;
  nome: string;
  descricao: string | null;
  foto_url: string | null;
  categoria_id: string | null;

  // ── preço (D1) ─────────────────────────────────────────────────────────────
  /** Preço de tabela — `produtos.preco`. SEMPRE presente. */
  preco: number;
  /** Preço que o cliente paga AGORA. Sem desconto vigente ⇒ === preco. NUNCA < 0. */
  precoEfetivo: number;
  /** true ⟺ existe desconto vigente NESTE instante. `precoEfetivo < preco`. */
  temDesconto: boolean;
  /** Rótulo do selo já pronto ("-20%" | "-R$ 10,00"); null quando !temDesconto. */
  seloDesconto: string | null;
  /** Fim da vigência em ISO-8601, quando há prazo. null = sem prazo. Só exibição. */
  descontoFim: string | null;

  // ── comprabilidade — PONTO DE EXTENSÃO DO SPEC B ───────────────────────────
  /** false ⇒ aparece no catálogo, mas sem botão de compra. */
  compravel: boolean;
  /** Por que não é comprável. null quando compravel === true. */
  motivoNaoCompravel: MotivoNaoCompravel | null;
};

/** v1 tem um membro só. O Spec B ACRESCENTA membros; não remove nem renomeia. */
export type MotivoNaoCompravel = "esgotado";

/**
 * Projeção do catálogo. PURA; `agora` injetado (determinismo no teste, e
 * vigência avaliada por request — nenhuma leitura de relógio aqui).
 *
 * Campo a campo, NUNCA por spread da row: as cinco colunas cruas de desconto
 * (e `loja_id`/`ordem`/`disponivel`/`oculto`) não trafegam ao cliente — o que a
 * UI não precisa, o payload RSC não carrega (regra 6 do contrato, precedente da
 * issue 201 com `foto_url`).
 *
 * Preço, selo e vigência saem TODOS de `precoEfetivo` (issue 223): é a única
 * fórmula de "desconto vira preço" no projeto, e duplicá-la aqui seria criar a
 * segunda verdade que a vitrine e o recálculo do pedido passariam a divergir.
 *
 * `compravel === disponivel` em v1 (D13/RN-19); `motivoNaoCompravel` é o ponto
 * de extensão do Spec B. Esgotado e promoção são ORTOGONAIS: produto sem
 * estoque continua mostrando o preço promocional.
 */
export function projetarProdutoVitrine(
  produto: ProdutoParaVitrine,
  agora: Date,
): ProdutoVitrine {
  const preco = precoEfetivo(produto, agora);

  return {
    id: produto.id,
    nome: produto.nome,
    descricao: produto.descricao,
    foto_url: produto.foto_url,
    categoria_id: produto.categoria_id,

    preco: produto.preco,
    precoEfetivo: preco.precoEfetivo,
    temDesconto: preco.temDesconto,
    seloDesconto: preco.seloDesconto,
    // Sem desconto vigente não existe contagem regressiva a exibir. Amarrar o
    // prazo à vigência mantém o objeto IDÊNTICO vindo da view `vitrine_produtos`
    // (que mascara as colunas fora da janela, 265) e da tabela crua (que não) —
    // sem isso, vitrine e recálculo divergiriam em silêncio num campo só.
    descontoFim: preco.temDesconto ? produto.desconto_fim : null,

    compravel: produto.disponivel,
    motivoNaoCompravel: produto.disponivel ? null : "esgotado",
  };
}
