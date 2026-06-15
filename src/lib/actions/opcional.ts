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
} from "@/lib/validacoes/opcional";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";

export type ResultadoOpcional = { ok: true } | { ok: false; erro: string };

const CAMINHO_PAINEL = "/painel/produtos/opcionais";

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

    // Substitui o conjunto: remove as associações atuais desta categoria de
    // produto e insere a seleção. Escopo por loja reforça o isolamento.
    const { error: erroDelete } = await supabase
      .from("categoria_produto_opcionais")
      .delete()
      .eq("loja_id", loja.id)
      .eq("categoria_id", categoria_id);
    if (erroDelete) {
      console.error("[salvarAssociacaoOpcionais:delete]", erroDelete);
      return { ok: false, erro: "Não foi possível salvar a associação." };
    }

    if (categoria_opcional_id.length > 0) {
      const linhas = categoria_opcional_id.map((catOpcId) => ({
        loja_id: loja.id,
        categoria_id,
        categoria_opcional_id: catOpcId,
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
