"use server";

/**
 * Server Actions de LOTE do cardápio sazonal (issue 251) — a metade de Server
 * Action da fatia crítica 5. Spec: specs/cardapio-sazonal.md · D2, D14 ·
 * RN-09, RN-09-a, RN-10, RN-11.
 *
 * O payload aqui é uma LISTA DE IDS escolhida pelo cliente: o vetor clássico de
 * IDOR. O contrato, espelhando `reordenarCategorias` (produto.ts:346):
 *
 *  - parse zod ANTES de qualquer I/O (nem `buscarLojaDoDono` é chamado se o
 *    payload não tem forma);
 *  - `loja_id` SEMPRE de `buscarLojaDoDono` (auth.uid()), NUNCA do payload;
 *  - client AUTENTICADO — `createServiceClient` (BYPASSRLS) não entra aqui;
 *  - **nenhum pre-check de posse em JS**: um `select` antes do `insert` seria
 *    TOCTOU e, pior, gravaria os ids válidos do lote, denunciando pela
 *    diferença entre pedido e resultado QUAIS ids existem em outra loja. A
 *    posse é provada DENTRO da transação: as FKs compostas de 20260920129000
 *    (`cardapio_produtos_produto_fk`, `cardapio_produtos_cardapio_fk`) derrubam
 *    a instrução inteira — tudo ou nada;
 *  - UMA mensagem genérica para id alheio, id inexistente, cardápio alheio e
 *    falha de banco. `23503`, nome de constraint e fragmento da RPC vão para o
 *    log do servidor, nunca para a tela (`seguranca.md` §14).
 */

import {
  schemaLoteDeProdutos,
  schemaLoteDeCategoria,
  schemaPreviaDeLote,
} from "@/lib/validacoes/cardapio";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; erro: string };

type Previa =
  | { ok: true; total: number; nomes: string[]; menu: number; cardapio: number }
  | { ok: false; erro: string };

/**
 * A ÚNICA mensagem que o lojista vê, para QUALQUER falha (RN-09). Mensagens
 * distintas por tipo de falha virariam oráculo de existência de id.
 */
const MSG_GENERICA =
  "Não foi possível aplicar o cardápio aos produtos selecionados.";

/** O diálogo mostra 6 nomes no desktop e 3 no mobile (design §10.3). */
const NOMES_NA_PREVIA = 6;

/**
 * RN-11: os três caminhos REAIS, e a vitrine pelo slug da PRÓPRIA loja. Nunca a
 * forma coringa `("/loja/[slug]", "page")`, que invalidaria o Router Cache da
 * vitrine de TODAS as lojas. `CAMINHO_PAINEL` de produto.ts:35
 * (`/painel/cardapio`, singular) não existe como rota — débito conhecido
 * (`architecture.md` §10), não reusado aqui de propósito.
 */
function revalidarCaminhosDoCardapio(slug: string): void {
  revalidatePath("/painel/cardapios");
  revalidatePath("/painel/produtos");
  revalidatePath(`/loja/${slug}`);
}

/**
 * Vincula uma SELEÇÃO EXPLÍCITA de produtos a um cardápio (RN-09).
 *
 * Uma única instrução com todos os ids: se qualquer um deles for de outra loja
 * ou inexistente, a FK composta derruba o lote inteiro e NENHUMA linha é
 * gravada — nem para os ids legítimos, nem na loja alheia. Um upsert por id
 * gravaria os bons e confirmaria, pela diferença, qual é o alheio.
 *
 * RN-10: idempotência vem do `on conflict do nothing` (`ignoreDuplicates`),
 * não de um SELECT prévio de "quem já está".
 */
export async function aplicarCardapioEmProdutos(
  payload: unknown,
): Promise<Resultado> {
  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };
  const { cardapio_id, produto_ids } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const linhas = produto_ids.map((produto_id) => ({
      loja_id: loja.id,
      cardapio_id,
      produto_id,
    }));

    const { error } = await supabase
      .from("cardapio_produtos")
      .upsert(linhas, {
        onConflict: "cardapio_id,produto_id",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error("[aplicarCardapioEmProdutos]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmProdutos]", e);
    return { ok: false, erro: MSG_GENERICA };
  }
}

/**
 * Vincula TODOS os produtos de uma categoria (RN-10), via a RPC da issue 250.
 *
 * A lista de produtos NUNCA é lida em JS para ser reenviada: a expansão
 * acontece dentro da transação (`insert ... select`), então produto criado ou
 * movido entre a leitura e a escrita não abre janela. Os fragmentos
 * `loja alheia` / `cardapio fora da loja` / `categoria fora da loja` das travas
 * T2/T3 são de log e de teste — aqui viram a mesma mensagem genérica.
 */
export async function aplicarCardapioEmCategoria(
  payload: unknown,
): Promise<Resultado> {
  const parsed = schemaLoteDeCategoria.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };
  const { cardapio_id, categoria_id } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const { error } = await supabase.rpc("aplicar_cardapio_em_categoria", {
      p_loja_id: loja.id,
      p_cardapio_id: cardapio_id,
      p_categoria_id: categoria_id,
    });
    if (error) {
      console.error("[aplicarCardapioEmCategoria]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmCategoria]", e);
    return { ok: false, erro: MSG_GENERICA };
  }
}

/**
 * Desfaz o vínculo (D2). O DELETE é escopado pela loja DERIVADA além da RLS:
 * o mesmo escopo explícito que `categoriaPertenceALoja` aplica no CRUD. Usa o
 * MESMO zod da gravação — teto, unicidade e forma não têm versão frouxa aqui.
 */
export async function tirarDeCardapio(payload: unknown): Promise<Resultado> {
  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };
  const { cardapio_id, produto_ids } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const { error } = await supabase
      .from("cardapio_produtos")
      .delete()
      .eq("loja_id", loja.id)
      .eq("cardapio_id", cardapio_id)
      .in("produto_id", produto_ids);
    if (error) {
      console.error("[tirarDeCardapio]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[tirarDeCardapio]", e);
    return { ok: false, erro: MSG_GENERICA };
  }
}

/**
 * Prévia do servidor para o diálogo de confirmação (RN-09-a). NÃO grava nada.
 *
 * A leitura é `where loja_id = <própria> and ...`: um id de outra loja
 * simplesmente NÃO volta. Nenhuma contagem de "ignorados", nenhum aviso — a
 * resposta de `[p1, pB]` é byte a byte a de `[p1]`, senão a prévia viraria
 * oráculo de existência (`seguranca.md` §14).
 *
 * D14: os dois números que o diálogo precisa (`menu` e `cardapio`) saem da
 * MESMA leitura — o cliente não conta nada e o servidor não lê duas vezes.
 */
export async function preverLoteAction(entrada: unknown): Promise<Previa> {
  const parsed = schemaPreviaDeLote.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const base = supabase
      .from("produtos")
      .select("id, nome, visibilidade")
      .eq("loja_id", loja.id);
    const consulta =
      "produto_ids" in parsed.data
        ? base.in("id", parsed.data.produto_ids)
        : base.eq("categoria_id", parsed.data.categoria_id);

    const { data, error } = await consulta;
    if (error) {
      console.error("[preverLoteAction]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    const linhas = data ?? [];
    return {
      ok: true,
      total: linhas.length,
      nomes: linhas.slice(0, NOMES_NA_PREVIA).map((p) => p.nome),
      menu: linhas.filter((p) => p.visibilidade === "menu").length,
      cardapio: linhas.filter((p) => p.visibilidade === "cardapio").length,
    };
  } catch (e) {
    console.error("[preverLoteAction]", e);
    return { ok: false, erro: MSG_GENERICA };
  }
}
