// Queries de `cardapios` para o SSR da vitrine e para o recálculo autoritativo
// (249/252, sob service_role). Só a QUERY + o índice em memória: a decisão de
// janela mora toda em `@/lib/utils/vigenciaCardapio` (RN-02..RN-05).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  paraCardapioVigencia,
  type CardapioVigencia,
} from "@/lib/utils/vigenciaCardapio";

type Client = SupabaseClient<Database>;

/**
 * Cardápio da loja: a vigência (246) + `ordem`, que é de APRESENTAÇÃO e por
 * isso não entra em `CardapioVigencia` (D4).
 */
export type CardapioDaLoja = CardapioVigencia & { ordem: number };

/**
 * Select NOMEADO (D4 da 265 — nunca `select("*")`), com o embed de
 * `cardapio_produtos` num único round trip (D5).
 */
export const COLUNAS_CARDAPIO_VIGENCIA =
  "id, nome, ativo, ordem, modo, dias_semana, dias_mes, hora_inicio, hora_fim, " +
  "prazo_inicio, prazo_fim, cardapio_produtos(produto_id)";

/** A row crua do PostgREST: `modo` é `string` (o CHECK não viaja ao TS). */
type LinhaCardapio = Omit<CardapioVigencia, "modo"> & {
  modo: string;
  ordem: number;
  cardapio_produtos: { produto_id: string }[] | null;
};

/**
 * Cardápios da loja + o índice `produto_id → cardápios` que a projeção da
 * vitrine consome (`projetarCatalogoVitrine`).
 *
 * SEM `.eq("ativo", true)` de propósito: RN-03 é decidida na função pura
 * (`avaliarVigenciaDoProduto` filtra `ativo`), e filtrar no SQL criaria a
 * segunda casa da regra — além de quebrar o reuso pela 249, que roda sob
 * `service_role` e precisa ver o mesmo conjunto que a vitrine.
 *
 * `.eq("loja_id", lojaId)` é EXPLÍCITO mesmo com a RLS cobrindo `anon`: é o que
 * torna a função segura sob `service_role` (BYPASSRLS) para 249/252 reusarem
 * sem escrever uma segunda query.
 *
 * Propaga `error` (§14). Engolir e seguir com `[]` faria a vitrine vender a
 * temporada inteira em silêncio.
 *
 * FAIL-CLOSED (D6): linha com `modo` fora do domínio é descartada, e os
 * vínculos dela não entram no `Map` — nenhum produto herda um cardápio que o
 * projeto não sabe avaliar.
 */
export async function buscarCardapiosComProdutos(
  client: Client,
  lojaId: string,
): Promise<{
  cardapios: CardapioDaLoja[];
  cardapiosPorProduto: Map<string, CardapioDaLoja[]>;
}> {
  const { data, error } = await client
    .from("cardapios")
    .select(COLUNAS_CARDAPIO_VIGENCIA)
    .eq("loja_id", lojaId)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  const linhas = (data ?? []) as unknown as LinhaCardapio[];
  const cardapios: CardapioDaLoja[] = [];
  const cardapiosPorProduto = new Map<string, CardapioDaLoja[]>();

  for (const linha of linhas) {
    const vigencia = paraCardapioVigencia(linha);
    if (vigencia === null) continue;

    const cardapio: CardapioDaLoja = { ...vigencia, ordem: linha.ordem };
    cardapios.push(cardapio);

    for (const vinculo of linha.cardapio_produtos ?? []) {
      const lista = cardapiosPorProduto.get(vinculo.produto_id);
      if (lista) lista.push(cardapio);
      else cardapiosPorProduto.set(vinculo.produto_id, [cardapio]);
    }
  }

  return { cardapios, cardapiosPorProduto };
}

/**
 * [256] Uma linha da lista de `/painel/cardapios`: a vigência + os DOIS
 * números de D14 que os diálogos destrutivos precisam mostrar.
 *
 * `menu` e `exclusivos` são PREVIEW DE UX recalculado a cada request — nenhuma
 * decisão depende deles. A autorização continua sendo a RLS do dono mais o
 * `.eq("loja_id")` explícito abaixo.
 */
export type CardapioDoPainel = CardapioDaLoja & {
  /** Produtos do MENU vinculados: continuam aparecendo e vendendo (RN-03). */
  menu: number;
  /**
   * Produtos EXCLUSIVOS que ficariam órfãos se este cardápio sumisse — os que
   * SOMEM da vitrine. É a mesma condição que `removerCardapio` avalia
   * (`visibilidade = 'cardapio'` E sem vínculo em nenhum outro cardápio), e
   * não "todos os exclusivos vinculados": quem está em dois cardápios não
   * corre risco nenhum e mentir sobre isso assustaria o lojista à toa.
   */
  exclusivos: number;
};

/**
 * Cardápios do lojista com os dois números por linha, em DUAS idas ao banco —
 * a segunda traz todos os vínculos da loja com a visibilidade do produto, e o
 * agrupamento acontece em memória. Um `count` por cardápio seria N+1.
 *
 * `.eq("loja_id", lojaId)` EXPLÍCITO nas duas, além da RLS: o mesmo cinto e
 * suspensório de `buscarCardapiosComProdutos`.
 *
 * Propaga `error` (§14): engolir e devolver `[]` mostraria "nenhum cardápio"
 * a quem tem cardápio no ar.
 */
export async function buscarCardapiosDoPainel(
  client: Client,
  lojaId: string,
): Promise<{
  cardapios: CardapioDoPainel[];
  /**
   * [264] Os produtos VINCULADOS a algum cardápio da loja, deduplicados — o
   * universo exato que `contarProdutosEscondidos` percorre (produto sem vínculo
   * nenhum não pode ter sumido por causa de cardápio). Sai do MESMO round trip
   * dos vínculos: nenhuma query nova entrou na página.
   */
  produtos: ProdutoVinculado[];
  /** [264] `produto_id → cardápios do produto`, para avaliar RN-13 por produto. */
  cardapiosPorProduto: Map<string, CardapioDaLoja[]>;
}> {
  const [{ cardapios, cardapiosPorProduto }, vinculos] = await Promise.all([
    buscarCardapiosComProdutos(client, lojaId),
    buscarVinculosComVisibilidade(client, lojaId),
  ]);

  // Quantos cardápios cada produto tem: 1 significa "só este", e é o que
  // transforma um exclusivo em órfão na remoção (RN-14).
  const quantosCardapios = new Map<string, number>();
  for (const v of vinculos) {
    quantosCardapios.set(
      v.produto_id,
      (quantosCardapios.get(v.produto_id) ?? 0) + 1,
    );
  }

  const linhas = cardapios.map((cardapio) => {
    let menu = 0;
    let exclusivos = 0;
    for (const v of vinculos) {
      if (v.cardapio_id !== cardapio.id) continue;
      if (v.visibilidade === "menu") menu++;
      else if ((quantosCardapios.get(v.produto_id) ?? 0) === 1) exclusivos++;
    }
    return { ...cardapio, menu, exclusivos };
  });

  const produtos = new Map<string, ProdutoVinculado>();
  for (const v of vinculos) {
    if (!produtos.has(v.produto_id)) {
      produtos.set(v.produto_id, {
        id: v.produto_id,
        nome: v.nome,
        visibilidade: v.visibilidade,
      });
    }
  }

  return {
    cardapios: linhas,
    produtos: [...produtos.values()],
    cardapiosPorProduto,
  };
}

/** [264] O mínimo que o aviso de RN-12 lê de um produto vinculado. */
export type ProdutoVinculado = {
  id: string;
  nome: string;
  visibilidade: string;
};

type VinculoComVisibilidade = {
  cardapio_id: string;
  produto_id: string;
  nome: string;
  visibilidade: string;
};

/** Os vínculos da loja inteira + nome e visibilidade do produto, num round trip. */
async function buscarVinculosComVisibilidade(
  client: Client,
  lojaId: string,
): Promise<VinculoComVisibilidade[]> {
  const { data, error } = await client
    .from("cardapio_produtos")
    .select("cardapio_id, produto_id, produtos!inner(nome, visibilidade)")
    .eq("loja_id", lojaId);
  if (error) throw error;

  type Embutido = { nome: string; visibilidade: string };
  const linhas = (data ?? []) as unknown as {
    cardapio_id: string;
    produto_id: string;
    produtos: Embutido | Embutido[] | null;
  }[];

  return linhas.map((linha) => {
    const produto = Array.isArray(linha.produtos)
      ? (linha.produtos[0] ?? null)
      : linha.produtos;
    return {
      cardapio_id: linha.cardapio_id,
      produto_id: linha.produto_id,
      nome: produto?.nome ?? "",
      visibilidade: produto?.visibilidade ?? "menu",
    };
  });
}

/**
 * [257] Um cardápio da loja, para a rota de detalhe. `null` quando o id não
 * existe OU é de outra loja — o `.eq("loja_id")` explícito além da RLS faz as
 * duas respostas serem indistinguíveis, então a rota não vira oráculo de
 * existência de id.
 *
 * FAIL-CLOSED (D6): `modo` fora do domínio devolve `null` em vez de uma
 * vigência que o projeto não sabe avaliar.
 */
export async function buscarCardapioPorId(
  client: Client,
  lojaId: string,
  id: string,
): Promise<CardapioVigencia | null> {
  const { data, error } = await client
    .from("cardapios")
    .select(
      "id, nome, ativo, modo, dias_semana, dias_mes, hora_inicio, hora_fim, prazo_inicio, prazo_fim",
    )
    .eq("loja_id", lojaId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (data == null) return null;

  return paraCardapioVigencia(data as unknown as Omit<CardapioVigencia, "modo"> & { modo: string });
}
