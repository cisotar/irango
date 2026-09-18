"use server";

// CRUD da biblioteca de opcionais (issues 088/089). Contrato espelha produto.ts
// (seguranca.md §2/§14):
//   - valida schemas de 084 (lib/validacoes/opcional.ts) ANTES de qualquer I/O;
//   - usa o client AUTENTICADO (RLS opcionais_*/opcionais_categorias_*/
//     categoria_produto_opcionais_*), NUNCA service_role;
//   - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload;
//   - referências cruzadas (categoria_opcional_id, categoria_id) são revalidadas
//     como da PRÓPRIA loja — a RLS só checa a loja_id da linha gravada, não a
//     posse das categorias referenciadas (defesa anti cross-tenant, RN-O8);
//   - erro de banco → genérico, sem vazar e.message.

import {
  schemaCategoriaOpcional,
  schemaOpcional,
  schemaAssociacaoCategoriaOpcional,
  schemaReordenacaoOpcionaisDaCategoria,
  schemaReordenacaoItensDoGrupo,
} from "@/lib/validacoes/opcional";
import { planejarAssociacaoOpcionais } from "@/lib/utils/associacao-opcionais";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";

export type ResultadoOpcional = { ok: true } | { ok: false; erro: string };

const CAMINHO_PAINEL = "/painel/produtos/opcionais";

/**
 * Mensagem ÚNICA para id alheio, lista incompleta, categoria de outra loja e
 * erro de banco (seguranca.md §14): mensagem distinta viraria oráculo de
 * existência de id. O detalhe fica no console.error do servidor.
 */
const ERRO_ORDEM = "Não foi possível salvar a ordem.";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Confere que a `categoria_opcional_id` pertence à PRÓPRIA loja do dono.
 * O SELECT passa pela RLS de `opcionais_categorias` (escopo do dono);
 * categoria alheia/inexistente → false (anti cross-loja).
 */
async function categoriaOpcionalPertenceALoja(
  supabase: Client,
  categoriaOpcionalId: string,
  lojaId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("opcionais_categorias")
    .select("id")
    .eq("id", categoriaOpcionalId)
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** Confere que a `categoria_id` (de PRODUTO) pertence à própria loja. */
async function categoriaProdutoPertenceALoja(
  supabase: Client,
  categoriaId: string,
  lojaId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("categorias")
    .select("id")
    .eq("id", categoriaId)
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

// ── Categorias de opcional ────────────────────────────────────────────────

export async function criarCategoriaOpcional(
  payload: unknown,
): Promise<ResultadoOpcional> {
  const parsed = schemaCategoriaOpcional.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Categoria de opcional inválida." };
  }
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("opcionais_categorias")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[criarCategoriaOpcional]", error);
      return { ok: false, erro: "Não foi possível salvar a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[criarCategoriaOpcional]", e);
    return { ok: false, erro: "Não foi possível salvar a categoria." };
  }
}

export async function atualizarCategoriaOpcional(
  id: string,
  payload: unknown,
): Promise<ResultadoOpcional> {
  const parsed = schemaCategoriaOpcional.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Categoria de opcional inválida." };
  }
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // loja_id reafirmado como o do dono + escopo por id; RLS rejeitaria troca.
    const { error } = await supabase
      .from("opcionais_categorias")
      .update({ ...parsed.data, loja_id: loja.id })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[atualizarCategoriaOpcional]", error);
      return { ok: false, erro: "Não foi possível salvar a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCategoriaOpcional]", e);
    return { ok: false, erro: "Não foi possível salvar a categoria." };
  }
}

export async function removerCategoriaOpcional(
  id: string,
): Promise<ResultadoOpcional> {
  try {
    const supabase = await createClient();
    // RLS opcionais_categorias_escrita_propria impede deletar de outra loja.
    // FK ON DELETE CASCADE remove os opcionais e associações dependentes.
    const { error } = await supabase
      .from("opcionais_categorias")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[removerCategoriaOpcional]", error);
      return { ok: false, erro: "Não foi possível remover a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[removerCategoriaOpcional]", e);
    return { ok: false, erro: "Não foi possível remover a categoria." };
  }
}

// ── Opcionais (itens da biblioteca) ─────────────────────────────────────────

export async function criarOpcional(
  payload: unknown,
): Promise<ResultadoOpcional> {
  const parsed = schemaOpcional.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Opcional inválido." };
  }
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // Posse explícita da categoria de opcional (defesa cross-loja, RN-O8).
    const pertence = await categoriaOpcionalPertenceALoja(
      supabase,
      parsed.data.categoria_opcional_id,
      loja.id,
    );
    if (!pertence) {
      return { ok: false, erro: "Categoria de opcional inválida." };
    }
    const { error } = await supabase
      .from("opcionais")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[criarOpcional]", error);
      return { ok: false, erro: "Não foi possível salvar o opcional." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[criarOpcional]", e);
    return { ok: false, erro: "Não foi possível salvar o opcional." };
  }
}

export async function atualizarOpcional(
  id: string,
  payload: unknown,
): Promise<ResultadoOpcional> {
  const parsed = schemaOpcional.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Opcional inválido." };
  }
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const pertence = await categoriaOpcionalPertenceALoja(
      supabase,
      parsed.data.categoria_opcional_id,
      loja.id,
    );
    if (!pertence) {
      return { ok: false, erro: "Categoria de opcional inválida." };
    }
    const { error } = await supabase
      .from("opcionais")
      .update({ ...parsed.data, loja_id: loja.id })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[atualizarOpcional]", error);
      return { ok: false, erro: "Não foi possível salvar o opcional." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarOpcional]", e);
    return { ok: false, erro: "Não foi possível salvar o opcional." };
  }
}

export async function alternarOpcionalAtivo(
  id: string,
  ativo: boolean,
): Promise<ResultadoOpcional> {
  try {
    const supabase = await createClient();
    // Toggle escopado por id; RLS isola por dono.
    const { error } = await supabase
      .from("opcionais")
      .update({ ativo })
      .eq("id", id);
    if (error) {
      console.error("[alternarOpcionalAtivo]", error);
      return { ok: false, erro: "Não foi possível atualizar o opcional." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[alternarOpcionalAtivo]", e);
    return { ok: false, erro: "Não foi possível atualizar o opcional." };
  }
}

export async function removerOpcional(id: string): Promise<ResultadoOpcional> {
  try {
    const supabase = await createClient();
    // RLS opcionais_escrita_propria impede deletar de outra loja. Pedidos
    // passados não são afetados (snapshot em itens_pedido_opcionais, RN-O6).
    const { error } = await supabase.from("opcionais").delete().eq("id", id);
    if (error) {
      console.error("[removerOpcional]", error);
      return { ok: false, erro: "Não foi possível remover o opcional." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[removerOpcional]", e);
    return { ok: false, erro: "Não foi possível remover o opcional." };
  }
}

// ── Associação categoria-de-produto ⋈ categorias-de-opcional (089) ──────────

/**
 * Grava em LOTE quais categorias de opcional ficam disponíveis para uma
 * categoria de PRODUTO. Idempotente: substitui o conjunto atual pela seleção.
 *
 * RN-O8: ambas as pontas (categoria de produto e cada categoria de opcional)
 * são revalidadas como da PRÓPRIA loja antes de qualquer escrita — a RLS só
 * garante `loja_id` da linha gravada, não a posse das categorias referenciadas.
 */
export async function salvarAssociacaoOpcionais(
  payload: unknown,
): Promise<ResultadoOpcional> {
  const parsed = schemaAssociacaoCategoriaOpcional.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Associação inválida." };
  }
  const { categoria_id, categoria_opcional_id } = parsed.data;
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    // Ponta 1: categoria de PRODUTO da própria loja.
    const produtoOk = await categoriaProdutoPertenceALoja(
      supabase,
      categoria_id,
      loja.id,
    );
    if (!produtoOk) {
      return { ok: false, erro: "Categoria de produto inválida." };
    }

    // Ponta 2: cada categoria de OPCIONAL selecionada da própria loja.
    for (const catOpcId of categoria_opcional_id) {
      const opcOk = await categoriaOpcionalPertenceALoja(
        supabase,
        catOpcId,
        loja.id,
      );
      if (!opcOk) {
        return { ok: false, erro: "Categoria de opcional inválida." };
      }
    }

    // RN-12: NÃO substitui o conjunto inteiro. O delete+insert de tudo zeraria
    // `categoria_produto_opcionais.ordem` (default 0) a cada clique de checkbox.
    // O plano é um DELTA: quem permanece não é tocado e mantém a ordem.
    const { data: associados, error: erroLeitura } = await supabase
      .from("categoria_produto_opcionais")
      .select("categoria_opcional_id, ordem")
      .eq("loja_id", loja.id)
      .eq("categoria_id", categoria_id);
    if (erroLeitura) {
      console.error("[salvarAssociacaoOpcionais:select]", erroLeitura);
      return { ok: false, erro: "Não foi possível salvar a associação." };
    }

    const plano = planejarAssociacaoOpcionais(associados ?? [], categoria_opcional_id);

    if (plano.remover.length > 0) {
      const { error: erroDelete } = await supabase
        .from("categoria_produto_opcionais")
        .delete()
        .eq("loja_id", loja.id)
        .eq("categoria_id", categoria_id)
        .in("categoria_opcional_id", plano.remover);
      if (erroDelete) {
        console.error("[salvarAssociacaoOpcionais:delete]", erroDelete);
        return { ok: false, erro: "Não foi possível salvar a associação." };
      }
    }

    if (plano.inserir.length > 0) {
      const linhas = plano.inserir.map((linha) => ({
        loja_id: loja.id,
        categoria_id,
        categoria_opcional_id: linha.categoria_opcional_id,
        ordem: linha.ordem,
      }));
      const { error: erroInsert } = await supabase
        .from("categoria_produto_opcionais")
        .insert(linhas);
      if (erroInsert) {
        console.error("[salvarAssociacaoOpcionais:insert]", erroInsert);
        return { ok: false, erro: "Não foi possível salvar a associação." };
      }
    }

    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[salvarAssociacaoOpcionais]", e);
    return { ok: false, erro: "Não foi possível salvar a associação." };
  }
}

// ── Reordenação dos grupos de opcional DENTRO de uma categoria de produto ────

/**
 * Grava `ordem` normalizada 0..n-1 para TODOS os grupos de opcional associados a
 * UMA categoria de produto, numa única instrução atômica (issue 208, RN-4).
 *
 * Isto é AUTORIZAÇÃO, não CRUD: o payload é uma lista de ids escolhida pelo
 * cliente. `p_loja_id` vem SEMPRE de `buscarLojaDoDono` (auth.uid()), NUNCA do
 * payload. Já `categoria_id` vem do payload — é o único parâmetro de escopo que
 * não deriva do auth — e por isso passa por `categoriaProdutoPertenceALoja`
 * antes da RPC (RN-5b), além do filtro `categoria_id` dentro da própria RPC e da
 * RLS por baixo.
 *
 * O pre-check de posse dos ids é deliberadamente deixado para a RPC: em JS ele
 * seria TOCTOU (a lista pode mudar entre o SELECT e o UPDATE); dentro da
 * transação, não. A RPC exige a PERMUTAÇÃO COMPLETA do par (loja, categoria) e
 * confere o `row_count` — id alheio, inexistente, duplicado ou de outra
 * categoria derruba a transação inteira.
 */
export async function reordenarOpcionaisDaCategoria(
  payload: unknown,
): Promise<ResultadoOpcional> {
  // 1) Forma ANTES de qualquer I/O. O parse devolve um objeto NOVO: propriedade
  //    hostil pendurada pelo cliente (ex.: `loja_id`) não chega aos args da RPC.
  const parsed = schemaReordenacaoOpcionaisDaCategoria.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: ERRO_ORDEM };
  }
  const { categoria_id, categoria_opcional_id } = parsed.data;

  try {
    // 2) Client AUTENTICADO. Desde a issue 215 a função é `security definer`,
    //    então a RLS `cat_prod_opc_escrita_propria` NÃO é mais a autoridade: a
    //    autoridade é a trava T2 no corpo da função, que exige
    //    `lojas.dono_id = auth.uid()` para o `p_loja_id` recebido. Ainda assim
    //    o client aqui é o autenticado, nunca `service_role` — é o `auth.uid()`
    //    da sessão que a T2 lê, e elevar aqui apagaria justamente esse sinal.
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: ERRO_ORDEM };
    }

    // 3) RN-5b: a categoria de PRODUTO veio do cliente — provar que é da loja.
    const produtoOk = await categoriaProdutoPertenceALoja(
      supabase,
      categoria_id,
      loja.id,
    );
    if (!produtoOk) {
      return { ok: false, erro: ERRO_ORDEM };
    }

    // 4) UMA ida ao banco, UMA instrução, atômica.
    const { error } = await supabase.rpc("reordenar_opcionais_da_categoria", {
      p_loja_id: loja.id,
      p_categoria_id: categoria_id,
      p_ids: categoria_opcional_id,
    });
    if (error) {
      console.error("[reordenarOpcionaisDaCategoria]", error);
      return { ok: false, erro: ERRO_ORDEM };
    }

    // A vitrine vai pelo slug da PRÓPRIA loja, nunca pela forma coringa
    // ("/loja/[slug]", "page"), que invalidaria o Router Cache de TODAS as lojas.
    revalidatePath(CAMINHO_PAINEL);
    revalidatePath(`/loja/${loja.slug}`);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarOpcionaisDaCategoria]", e);
    return { ok: false, erro: ERRO_ORDEM };
  }
}

// ── Reordenação dos ITENS dentro de UM grupo de opcional (issue 215) ─────────

/**
 * Grava `ordem` normalizada 0..n-1 para TODOS os itens (`opcionais`) de UM grupo
 * (`opcionais_categorias`), numa única instrução atômica.
 *
 * Irmã de `reordenarOpcionaisDaCategoria`, um nível abaixo na árvore, com as
 * MESMAS garantias: isto é AUTORIZAÇÃO, não CRUD — o payload é uma lista de ids
 * escolhida pelo cliente. `p_loja_id` vem SEMPRE de `buscarLojaDoDono`
 * (auth.uid()), NUNCA do payload. Já `categoria_opcional_id` vem do payload — é
 * o único parâmetro de escopo que não deriva do auth — e por isso passa por
 * `categoriaOpcionalPertenceALoja` antes da RPC, além da trava T3
 * (coerência loja↔grupo) dentro da própria RPC.
 *
 * O pre-check de posse dos ids fica deliberadamente na RPC: em JS ele seria
 * TOCTOU (a lista pode mudar entre o SELECT e o UPDATE); dentro da transação,
 * não. A RPC exige a PERMUTAÇÃO COMPLETA do par (loja, grupo) e confere o
 * `row_count` — id alheio, inexistente, duplicado ou de outro grupo derruba a
 * transação inteira, sem posição parcial gravada.
 */
export async function reordenarItensDoGrupoOpcional(
  payload: unknown,
): Promise<ResultadoOpcional> {
  // 1) Forma ANTES de qualquer I/O. O parse devolve um objeto NOVO: propriedade
  //    hostil pendurada pelo cliente (ex.: `loja_id`) não chega aos args da RPC.
  const parsed = schemaReordenacaoItensDoGrupo.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: ERRO_ORDEM };
  }
  const { categoria_opcional_id, opcional_id } = parsed.data;

  try {
    // 2) Client AUTENTICADO — a função é `security definer` e lê `auth.uid()`
    //    na trava T2; elevar a `service_role` aqui apagaria esse sinal.
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: ERRO_ORDEM };
    }

    // 3) O grupo veio do cliente — provar que é da PRÓPRIA loja (RN-O8).
    const grupoOk = await categoriaOpcionalPertenceALoja(
      supabase,
      categoria_opcional_id,
      loja.id,
    );
    if (!grupoOk) {
      return { ok: false, erro: ERRO_ORDEM };
    }

    // 4) UMA ida ao banco, UMA instrução, atômica. A SEQUÊNCIA do payload é o
    //    dado: `p_ids` vai na ordem recebida, sem normalização.
    const { error } = await supabase.rpc("reordenar_itens_do_grupo_opcional", {
      p_loja_id: loja.id,
      p_categoria_opcional_id: categoria_opcional_id,
      p_ids: opcional_id,
    });
    if (error) {
      console.error("[reordenarItensDoGrupoOpcional]", error);
      return { ok: false, erro: ERRO_ORDEM };
    }

    // Slug da PRÓPRIA loja, nunca a forma coringa ("/loja/[slug]", "page"), que
    // invalidaria o Router Cache de TODAS as lojas do marketplace.
    revalidatePath(CAMINHO_PAINEL);
    revalidatePath(`/loja/${loja.slug}`);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarItensDoGrupoOpcional]", e);
    return { ok: false, erro: ERRO_ORDEM };
  }
}
