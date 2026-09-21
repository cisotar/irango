// Contrato de catálogo v1 — dono:
// `specs/desconto-por-produto-e-pratos-promocionais.md` §Contrato de catálogo.
// Produzido SEMPRE no servidor. Todo número monetário aqui já é autoritativo na
// origem; o que o cliente faz com ele depois é preview (seguranca.md §10).
import type { Tables } from "@/lib/database.types";
import { precoEfetivo, type ProdutoComDesconto } from "./precoEfetivo";
import {
  avaliarVigenciaDoProduto,
  cardapioAberto,
  visibilidadeDe,
  type CardapioVigencia,
} from "./vigenciaCardapio";
import {
  escolherCardapioParaRotulo,
  proximaAbertura,
  rotuloVoltaQuando,
  ROTULO_SEM_VOLTA,
} from "./descreverVigencia";

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

/** v1 tinha um membro só. O Spec B (247) ACRESCENTA; não remove nem renomeia. */
export type MotivoNaoCompravel = "esgotado" | "fora_da_janela";

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
// 247 — `compravel` compõe `disponivel` com a vigência do cardápio. A decisão
// de janela vem TODA de `avaliarVigenciaDoProduto` (246): nenhuma aritmética de
// fuso, de dia da semana ou de prazo é reescrita aqui.
export function projetarProdutoVitrine(
  produto: ProdutoParaVitrine & { visibilidade: string },
  cardapios: CardapioVigencia[],
  agora: Date,
  timezone: string,
): ProdutoVitrine {
  const preco = precoEfetivo(produto, agora);
  const vigencia = avaliarVigenciaDoProduto(
    { visibilidade: visibilidadeDe(produto) },
    cardapios,
    agora,
    timezone,
  );
  const compravel = produto.disponivel && vigencia.dentroDaJanela;

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

    compravel,
    // PRECEDÊNCIA de RN-05: a janela ganha de "esgotado". Numa terça a feijoada
    // do cardápio de fim de semana não acabou — ela não é servida hoje, e só a
    // restrição de janela sabe dizer quando volta (D4).
    motivoNaoCompravel: compravel
      ? null
      : !vigencia.dentroDaJanela
        ? "fora_da_janela"
        : "esgotado",
  };
}

/**
 * Ponto de entrada por CATÁLOGO (247). Dono das três saídas correlacionadas,
 * para que não exista caminho que produza o produto marcado sem o rótulo dele.
 *
 * RN-13/D14: o produto sem `visivelNaVitrine` NÃO entra na lista devolvida —
 * some antes de qualquer agrupamento, do mesmo jeito que `oculto` nunca entra.
 * É o que faz a regra do grupo vazio (issue 177, dentro de `agruparCatalogo`)
 * cobrir a categoria esvaziada pela temporada sem uma linha de código nova, e o
 * que garante que o produto fora de temporada nunca chega ao payload RSC.
 *
 * Genérica em `C extends CardapioVigencia` (D4): `ordem` — que é de
 * apresentação e a 248 consome — sobrevive à projeção sem que o módulo de
 * vigência precise conhecê-la.
 */
export function projetarCatalogoVitrine<C extends CardapioVigencia>(entrada: {
  produtos: (ProdutoParaVitrine & { visibilidade: string })[];
  cardapiosPorProduto: Map<string, C[]>;
  agora: Date;
  timezone: string;
}): {
  produtos: ProdutoVitrine[];
  rotulosVigencia: Record<string, string>;
  cardapiosAbertos: C[];
} {
  const { produtos: entradaProdutos, cardapiosPorProduto, agora, timezone } = entrada;

  const produtos: ProdutoVitrine[] = [];
  const rotulosVigencia: Record<string, string> = {};

  // 254/RN-07 — "quando volta" é calculado UMA VEZ POR CARDÁPIO por request,
  // nunca por produto: a varredura adiante do recorrente é cara e uma loja tem
  // poucos cardápios, enquanto o mesmo cardápio serve dezenas de produtos.
  const aberturaPorCardapio = new Map<string, Date | null>();
  const proxima = (cardapio: C): Date | null => {
    const memoizado = aberturaPorCardapio.get(cardapio.id);
    if (memoizado !== undefined) return memoizado;
    const valor = proximaAbertura(cardapio, agora, timezone);
    aberturaPorCardapio.set(cardapio.id, valor);
    return valor;
  };

  for (const produto of entradaProdutos) {
    const cardapios = cardapiosPorProduto.get(produto.id) ?? [];
    const vigencia = avaliarVigenciaDoProduto(
      { visibilidade: visibilidadeDe(produto) },
      cardapios,
      agora,
      timezone,
    );
    if (!vigencia.visivelNaVitrine) continue;

    const projetado = projetarProdutoVitrine(produto, cardapios, agora, timezone);
    produtos.push(projetado);
    // O par produto-marcado/rótulo é indivisível: nasce no MESMO passo.
    if (projetado.motivoNaoCompravel === "fora_da_janela") {
      // 254/RN-07 — de N cardápios fechados, a frase é a do que ABRE MAIS
      // CEDO, por escada determinística (`proximaAbertura` → `nome` → `id`). A
      // UI nunca escolhe, e o texto desce pronto do servidor. Sem volta
      // conhecida, o fallback defensivo de render (design §4.1): por RN-13 o
      // produto de cardápio nesse estado nem chega aqui.
      const dono = escolherCardapioParaRotulo(cardapios, proxima);
      rotulosVigencia[projetado.id] = dono
        ? rotuloVoltaQuando(dono, timezone)
        : ROTULO_SEM_VOLTA;
    }
  }

  // Os cardápios abertos AGORA, deduplicados por id (um cardápio aparece uma vez
  // por produto vinculado). Consumido pela 248, que NÃO reavalia a janela.
  const vistos = new Set<string>();
  const cardapiosAbertos: C[] = [];
  for (const lista of cardapiosPorProduto.values()) {
    for (const cardapio of lista) {
      if (vistos.has(cardapio.id)) continue;
      vistos.add(cardapio.id);
      if (cardapioAberto(cardapio, agora, timezone)) cardapiosAbertos.push(cardapio);
    }
  }

  return { produtos, rotulosVigencia, cardapiosAbertos };
}
