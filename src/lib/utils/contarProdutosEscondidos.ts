/**
 * [264/RN-12] Quantos produtos SUMIRAM da vitrine por causa deste cardápio — e
 * quantos continuam vendendo apesar dele.
 *
 * Por que existe: com D14, o produto exclusivo de um cardápio expirado ou
 * desligado some da vitrine, e o lojista não vê nada — a loja dele parece
 * simplesmente menor. O painel é o ÚNICO lugar do sistema onde esse estado é
 * observável. Sem estes dois números, D14 troca um problema visível por um
 * invisível.
 *
 * Por que é módulo puro e não contagem no `.tsx`: sem jsdom, a única forma de
 * travar o número (e a frase que ele produz) neste repo é fora do componente.
 *
 * **Preview de UX.** Nenhuma decisão depende destes números: a recusa da
 * remoção é da Server Action (RN-14), a autorização é a RLS e a visibilidade
 * real do produto é `avaliarVigenciaDoProduto`. Eles são recalculados no
 * servidor a cada render; o cliente nunca os envia.
 *
 * **O predicado é UM SÓ.** "Expirado" e "desligado" não são dois casos: os dois
 * caem em `proximaAbertura === null` (RN-13), e quem responde isso aqui é a
 * MESMA função que decide se o produto aparece na vitrine
 * (`avaliarVigenciaDoProduto`, 246) — nunca um segundo critério de "quando
 * volta" escrito neste arquivo.
 */

import {
  avaliarVigenciaDoProduto,
  visibilidadeDe,
  type CardapioVigencia,
} from "./vigenciaCardapio";

/** O mínimo que a contagem lê de um produto. `nome` é para NOMEAR os sumidos. */
export type ProdutoContado = {
  id: string;
  nome: string;
  visibilidade: string;
};

/** `produto_id → cardápios do produto` — o índice de `buscarCardapiosComProdutos`. */
export type CardapiosPorProdutoLidos = ReadonlyMap<string, CardapioVigencia[]>;

/** Está vinculado a ESTE cardápio? */
function vinculado(
  produtoId: string,
  cardapioId: string,
  vinculos: CardapiosPorProdutoLidos,
): boolean {
  return (vinculos.get(produtoId) ?? []).some((c) => c.id === cardapioId);
}

/**
 * Os produtos que sumiram da vitrine por causa deste cardápio, na ordem em que
 * `produtos` chegou.
 *
 * "Sumiu" é `visibilidade = 'cardapio'` **e** `visivelNaVitrine === false`
 * avaliado sobre TODOS os cardápios do produto — não sobre este. O exclusivo
 * que também está num cardápio aberto (ou que ainda vai abrir) **não sumiu**, e
 * contá-lo assustaria o lojista à toa. Produto do menu nunca entra: RN-05
 * curto-circuita antes de olhar cardápio nenhum.
 *
 * Existe além de `contarProdutosEscondidos` porque a saída "Devolver os N ao
 * menu" precisa NOMEAR os N no `AlertDialog` (design §13.4 item 3) — e o número
 * e a lista têm de sair do mesmo lugar, senão o diálogo nomeia um conjunto e o
 * botão converte outro.
 */
export function listarProdutosEscondidos<P extends ProdutoContado>(
  cardapio: CardapioVigencia,
  produtos: readonly P[],
  vinculos: CardapiosPorProdutoLidos,
  agora: Date,
  timezone: string,
): P[] {
  return produtos.filter((produto) => {
    if (!vinculado(produto.id, cardapio.id, vinculos)) return false;
    if (visibilidadeDe(produto) !== "cardapio") return false;

    const { visivelNaVitrine } = avaliarVigenciaDoProduto(
      { visibilidade: "cardapio" },
      vinculos.get(produto.id) ?? [],
      agora,
      timezone,
    );
    return !visivelNaVitrine;
  });
}

/**
 * RN-12 — os dois números do aviso, na ordem em que o design os exibe:
 * primeiro o que sumiu, depois o que continua vendendo.
 *
 * `sumidos === 0` ⇒ não há aviso a dar (a copy decide isso, ver
 * `copiaCardapioPainel.ts`): é o estado normal de um cardápio no ar, e de um
 * cardápio guardado que não levava exclusivo nenhum.
 */
export function contarProdutosEscondidos(
  cardapio: CardapioVigencia,
  produtos: readonly ProdutoContado[],
  vinculos: CardapiosPorProdutoLidos,
  agora: Date,
  timezone: string,
): { doMenu: number; sumidos: number } {
  const doMenu = produtos.filter(
    (p) =>
      vinculado(p.id, cardapio.id, vinculos) && visibilidadeDe(p) === "menu",
  ).length;

  const sumidos = listarProdutosEscondidos(
    cardapio,
    produtos,
    vinculos,
    agora,
    timezone,
  ).length;

  return { doMenu, sumidos };
}

/** [264] Por qual cardápio este produto sumiu, e se ele foi DESLIGADO. */
export type SumicoDoProduto = {
  /** Nome do cardápio a quem atribuir o sumiço, para a frase da linha. */
  cardapio: string;
  /** `true` = expirou (segue ligado); `false` = o lojista desligou. */
  ativo: boolean;
};

/**
 * [264/design §13.4 item 5] O mesmo estado, visto do lado do PRODUTO — é o que
 * a linha de `/painel/produtos` precisa para dizer *"sumiu da vitrine — o
 * cardápio X expirou"*.
 *
 * `null` = o produto está na vitrine. O predicado é o MESMO de
 * `listarProdutosEscondidos` (`visivelNaVitrine`, 246): um produto não pode
 * estar sumido numa tela e presente na outra.
 *
 * O cardápio "culpado" é escolhido por escada determinística (`nome` pt-BR →
 * `id`) porque aqui TODOS os candidatos estão sem volta — não existe "o que
 * abre mais cedo" a desempatar. Determinismo importa: a frase não pode trocar
 * de cardápio a cada refresh.
 */
export function diagnosticarSumico(
  produto: { visibilidade: string },
  cardapios: readonly CardapioVigencia[],
  agora: Date,
  timezone: string,
): SumicoDoProduto | null {
  if (visibilidadeDe(produto) !== "cardapio") return null;

  const { visivelNaVitrine } = avaliarVigenciaDoProduto(
    { visibilidade: "cardapio" },
    [...cardapios],
    agora,
    timezone,
  );
  if (visivelNaVitrine) return null;

  const culpado = [...cardapios].sort((a, b) => {
    const porNome = a.nome.localeCompare(b.nome, "pt-BR");
    return porNome !== 0 ? porNome : a.id.localeCompare(b.id);
  })[0];
  // Exclusivo sem cardápio nenhum é impossível por trigger (RN-14); se o dado
  // escapar mesmo assim, a linha não inventa um cardápio que não existe.
  return culpado ? { cardapio: culpado.nome, ativo: culpado.ativo } : null;
}
