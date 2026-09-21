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
