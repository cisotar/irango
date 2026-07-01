"use server";

// CRUD de produtos e categorias do LOJISTA (issue 031). Contrato espelha o de
// cupom.ts (seguranca.md §2/§14):
//   - valida schemaProduto/schemaCategoria ANTES de qualquer I/O;
//   - usa o client AUTENTICADO (RLS produtos_escrita_propria / categorias_
//     escrita_propria), NUNCA service_role;
//   - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload;
//   - categoria_id (quando informada) deve pertencer à PRÓPRIA loja — a RLS de
//     produtos só checa produtos.loja_id, não a posse da categoria, então a
//     action valida explicitamente (defesa contra referência cross-loja);
//   - erro de banco → genérico, sem vazar e.message.
//   - remover categoria deixa produtos com categoria_id NULL (FK ON DELETE SET NULL).

import { schemaProduto, schemaCategoria } from "@/lib/validacoes/produto";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";

export type ResultadoGestaoProduto = { ok: true } | { ok: false; erro: string };
export type ResultadoGestaoCategoria =
  | { ok: true }
  | { ok: false; erro: string };

const CAMINHO_PAINEL = "/painel/cardapio";

/**
 * Confere que a `categoria_id` informada pertence à PRÓPRIA loja do dono.
 * A RLS de `produtos` só valida `produtos.loja_id` (WITH CHECK) e a FK só garante
 * que a categoria EXISTE em ALGUMA loja — então sem este SELECT escopado seria
 * possível referenciar uma categoria de OUTRA loja (cross-loja). O SELECT passa
 * pela RLS `categorias_*` (escopo do dono); categoria alheia/inexistente → null.
 */
async function categoriaPertenceALoja(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export async function criarProduto(
  payload: unknown,
): Promise<ResultadoGestaoProduto> {
  // 1) Valida/normaliza a FORMA do produto ANTES de qualquer I/O. Lixo (preço
  //    negativo/NaN/>2 casas, nome vazio) nem chega ao banco.
  const parsed = schemaProduto.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Produto inválido." };
  }

  try {
    // 2) Client AUTENTICADO — RLS produtos_escrita_propria isola por dono.
    const supabase = await createClient();
    // 3) loja_id DERIVADO da loja do dono, NUNCA do payload.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    // 4) Posse explícita da categoria (defesa cross-loja).
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(
        supabase,
        parsed.data.categoria_id,
        loja.id,
      );
      if (!pertence) {
        return { ok: false, erro: "Categoria inválida." };
      }
    }

    const { error } = await supabase
      .from("produtos")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[criarProduto]", error);
      return { ok: false, erro: "Não foi possível salvar o produto." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[criarProduto]", e);
    return { ok: false, erro: "Não foi possível salvar o produto." };
  }
}

export async function atualizarProduto(
  id: string,
  payload: unknown,
): Promise<ResultadoGestaoProduto> {
  const parsed = schemaProduto.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Produto inválido." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(
        supabase,
        parsed.data.categoria_id,
        loja.id,
      );
      if (!pertence) {
        return { ok: false, erro: "Categoria inválida." };
      }
    }

    // loja_id reafirmado como o do dono (a RLS rejeitaria troca, mas nem
    // oferecemos a opção) + escopo por id.
    const { error } = await supabase
      .from("produtos")
      .update({ ...parsed.data, loja_id: loja.id })
      .eq("id", id);
    if (error) {
      console.error("[atualizarProduto]", error);
      return { ok: false, erro: "Não foi possível salvar o produto." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarProduto]", e);
    return { ok: false, erro: "Não foi possível salvar o produto." };
  }
}

export async function removerProduto(
  id: string,
): Promise<ResultadoGestaoProduto> {
  try {
    const supabase = await createClient();
    // RLS produtos_escrita_propria impede deletar produto de outra loja.
    const { error } = await supabase.from("produtos").delete().eq("id", id);
    if (error) {
      console.error("[removerProduto]", error);
      return { ok: false, erro: "Não foi possível remover o produto." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[removerProduto]", e);
    return { ok: false, erro: "Não foi possível remover o produto." };
  }
}

export async function alternarDisponibilidade(
  id: string,
  disponivel: boolean,
): Promise<ResultadoGestaoProduto> {
  try {
    const supabase = await createClient();
    // Toggle escopado por id; RLS isola por dono.
    const { error } = await supabase
      .from("produtos")
      .update({ disponivel })
      .eq("id", id);
    if (error) {
      console.error("[alternarDisponibilidade]", error);
      return { ok: false, erro: "Não foi possível atualizar o produto." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[alternarDisponibilidade]", e);
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }
}

export async function alternarOculto(
  id: string,
  oculto: boolean,
): Promise<ResultadoGestaoProduto> {
  try {
    const supabase = await createClient();
    // Toggle de VISIBILIDADE escopado por id; RLS produtos_escrita_propria
    // isola por dono. NÃO mexe em `disponivel` (RN-6-b).
    const { error } = await supabase
      .from("produtos")
      .update({ oculto })
      .eq("id", id);
    if (error) {
      console.error("[alternarOculto]", error);
      return { ok: false, erro: "Não foi possível atualizar o produto." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[alternarOculto]", e);
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }
}

export async function criarCategoria(
  payload: unknown,
): Promise<ResultadoGestaoCategoria> {
  const parsed = schemaCategoria.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Categoria inválida." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("categorias")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[criarCategoria]", error);
      return { ok: false, erro: "Não foi possível salvar a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[criarCategoria]", e);
    return { ok: false, erro: "Não foi possível salvar a categoria." };
  }
}

export async function atualizarCategoria(
  id: string,
  payload: unknown,
): Promise<ResultadoGestaoCategoria> {
  const parsed = schemaCategoria.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Categoria inválida." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("categorias")
      .update({ ...parsed.data, loja_id: loja.id })
      .eq("id", id);
    if (error) {
      console.error("[atualizarCategoria]", error);
      return { ok: false, erro: "Não foi possível salvar a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCategoria]", e);
    return { ok: false, erro: "Não foi possível salvar a categoria." };
  }
}

export async function removerCategoria(
  id: string,
): Promise<ResultadoGestaoCategoria> {
  try {
    const supabase = await createClient();
    // Só DELETE escopado por id — a FK categoria_id ON DELETE SET NULL zera
    // categoria_id dos produtos no banco (não mexemos em produtos aqui).
    const { error } = await supabase.from("categorias").delete().eq("id", id);
    if (error) {
      console.error("[removerCategoria]", error);
      return { ok: false, erro: "Não foi possível remover a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[removerCategoria]", e);
    return { ok: false, erro: "Não foi possível remover a categoria." };
  }
}
