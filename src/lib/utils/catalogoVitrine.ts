// Contrato de catálogo v1 — dono:
// `specs/desconto-por-produto-e-pratos-promocionais.md` §Contrato de catálogo.
// Produzido SEMPRE no servidor. Todo número monetário aqui já é autoritativo na
// origem; o que o cliente faz com ele depois é preview (seguranca.md §10).
import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";
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
  /**
   * [248/RN-06] `categoria_id → exibir_imagens`. Categoria com `false` ⇒ a
   * `foto_url` sai `null` DAQUI — a decisão vira PROPRIEDADE DO PRODUTO, não
   * do grupo que o renderiza.
   *
   * Era decidida por grupo em `page.tsx` (issue 201). Com D16-a o mesmo produto
   * passa a aparecer TAMBÉM na seção de destaque, que não é de categoria
   * nenhuma: a cópia de lá carregaria a URL da foto que o lojista mandou
   * esconder, regredindo a 201. Movendo o zeramento para cá, o produto viaja
   * com UM `foto_url` para onde for, e nenhuma seção nova pode escapar — a
   * regressão fica impossível, em vez de corrigida.
   *
   * Ausente (default) ⇒ nada é zerado: o recálculo e os testes que não conhecem
   * categoria continuam vendo exatamente o objeto de antes.
   */
  exibirImagensPorCategoria?: ReadonlyMap<string, boolean>,
): ProdutoVitrine {
  // Só `false` esconde. Categoria ausente do mapa, produto sem categoria
  // ("Outros") e `true` seguem com a foto — mesma regra de `page.tsx` (RN-5).
  const ocultaImagem =
    produto.categoria_id !== null &&
    exibirImagensPorCategoria?.get(produto.categoria_id) === false;
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
    // RN-3/RN-6 (201, corrigida pela 248): em categoria "ocultar" a URL não
    // trafega ao cliente — zerada no SSR, não escondida no render.
    foto_url: ocultaImagem ? null : produto.foto_url,
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
  /**
   * [248/RN-06] `categoria_id → exibir_imagens`, repassado a cada produto.
   * Opcional para não quebrar caller nenhum; sem ele nada é zerado.
   */
  exibirImagensPorCategoria?: ReadonlyMap<string, boolean>;
}): {
  produtos: ProdutoVitrine[];
  rotulosVigencia: Record<string, string>;
  cardapiosAbertos: C[];
} {
  const {
    produtos: entradaProdutos,
    cardapiosPorProduto,
    agora,
    timezone,
    exibirImagensPorCategoria,
  } = entrada;

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

    const projetado = projetarProdutoVitrine(
      produto,
      cardapios,
      agora,
      timezone,
      exibirImagensPorCategoria,
    );
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

// ───────────────────────────────────────────────────────────────────────────
// [248] D16 — a seção de destaque do cardápio ABERTO, na camada pura
// ───────────────────────────────────────────────────────────────────────────

/**
 * Uma seção do catálogo da vitrine: a seção de CATEGORIA que já existe, mais o
 * discriminante. **Um campo a mais, não um tipo novo** — a seção de categoria
 * continua sendo exatamente o objeto de hoje, e por isso o render das seções
 * de categoria não muda (critério de aceite da 248).
 *
 * O `import type` de um módulo `'use client'` é apagado na compilação: nenhum
 * valor cruza a fronteira (mesmo precedente do `page.tsx`, issue 201/D1).
 */
export type SecaoVitrine = CategoriaComProdutos & {
  tipo: "cardapio" | "categoria";
};

/**
 * [248/D16/RN-15] As seções de DESTAQUE: uma por cardápio ABERTO agora, com os
 * produtos vinculados a ele.
 *
 * **Irmã de `agruparCatalogo`, não refactor dela**: são duas VISÕES da mesma
 * lista, e unificá-las num agrupador com dois modos é exatamente o refactor que
 * o critério de aceite proíbe (a suíte de `agruparCatalogo` passa sem uma
 * edição). Aqui não há categoria, não há grupo "Outros" e a ordem é outra.
 *
 * **Não reavalia janela nenhuma.** `cardapiosAbertos` vem pronto de
 * `projetarCatalogoVitrine` — "está aberto?" tem UMA resposta por request
 * (RN-15). Como consequência de propriedade, e não de filtro: todo produto de
 * cardápio aberto está `dentroDaJanela` (a janela do produto é a UNIÃO dos
 * cardápios dele), então **nenhum produto de seção de destaque está fora da
 * janela**. Esgotado, sim — e aparece, com o selo de esgotado, porque
 * `disponivel` é ortogonal à janela.
 *
 * **Seção vazia não é emitida** (`filter(s => s.produtos.length > 0)`): a mesma
 * regra da issue 177, aplicada de novo, não reinventada. Cardápio aberto cujos
 * produtos foram todos ocultados não pinta cabeçalho que não leva a lugar nenhum.
 *
 * **Ordem `cardapios.ordem` → `nome` (pt-BR) → `id`** — a MESMA escada de RN-07
 * (`escolherCardapioParaRotulo`). Duas ordenações diferentes de cardápio é como
 * nasce bug de "a seção mudou de lugar sozinha".
 *
 * **A duplicata é de RENDER, nunca de dado**: o mesmo `ProdutoVitrine` (a mesma
 * referência) sai aqui e na seção de categoria dele. Carrinho, checkout e
 * `criarPedido` continuam vendo UM produto — e a `foto_url` já vem resolvida da
 * projeção, então a cópia do destaque não pode carregar URL que a categoria
 * esconde.
 *
 * `exibir_imagens` fica ausente (⇒ grid de `CardProduto`, design §13.1 item 1):
 * a seção de destaque não é de categoria nenhuma e o produto de categoria
 * "ocultar" aparece ali sem foto, com o placeholder de gradiente do grid —
 * consequência direta de o `foto_url` já estar `null` no produto.
 */
export function agruparPorCardapio<C extends CardapioVigencia & { ordem: number }>(
  produtos: readonly ProdutoVitrine[],
  cardapiosAbertos: readonly C[],
  cardapiosPorProduto: ReadonlyMap<string, C[]>,
): SecaoVitrine[] {
  if (cardapiosAbertos.length === 0) return [];

  // Ordena os CARDÁPIOS uma vez, antes de montar as seções: a ordem das seções
  // nasce pronta, sem reordenar objetos que carregam a lista de produtos (e sem
  // precisar reencontrar o cardápio de cada seção pelo id depois).
  const ordenados = [...cardapiosAbertos].sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    const porNome = a.nome.localeCompare(b.nome, "pt-BR");
    if (porNome !== 0) return porNome;
    return a.id.localeCompare(b.id);
  });

  const secoes = new Map<string, SecaoVitrine>(
    ordenados.map((c) => [
      c.id,
      { id: c.id, nome: c.nome, tipo: "cardapio", produtos: [] },
    ]),
  );

  // Varre os PRODUTOS (não os cardápios): preserva a ordem em que a lista
  // projetada chegou, que é a de `produtos.ordem` do SSR. A seção NÃO reordena
  // nada por dentro (§Fora do Escopo).
  for (const produto of produtos) {
    // Deduplica por id: o mesmo cardápio pode aparecer duas vezes na lista de
    // um produto se o vínculo vier duplicado do banco.
    const vistos = new Set<string>();
    for (const cardapio of cardapiosPorProduto.get(produto.id) ?? []) {
      if (vistos.has(cardapio.id)) continue;
      vistos.add(cardapio.id);
      // D16-a: produto em DOIS cardápios abertos sai nas DUAS seções — e na
      // categoria dele, que é outro agrupador. Cardápio FECHADO não tem seção
      // no mapa, então o `?.` já é o filtro de RN-15: nenhuma janela é
      // reavaliada aqui.
      secoes.get(cardapio.id)?.produtos.push(produto);
    }
  }

  // Grupo sem nenhum produto visível NÃO é devolvido (issue 177, reaplicada).
  return [...secoes.values()].filter((secao) => secao.produtos.length > 0);
}
