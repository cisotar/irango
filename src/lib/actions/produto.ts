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

import {
  schemaProduto,
  schemaProdutoUpdate,
  schemaIdProduto,
  schemaCategoria,
  schemaReordenacaoCategorias,
  schemaVisibilidadeEmLote,
} from "@/lib/validacoes/produto";
// Contrato NEUTRO compartilhado com o caminho ADMIN (issue 241): mensagem de
// D10 e conversão de prazo pelo fuso têm UMA fonte, não duas cópias.
import {
  erroDeParseProduto,
  comPrazosNoFuso,
  erroDeEscritaDeProduto,
} from "@/lib/actions/produto-contrato";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";

export type ResultadoGestaoProduto = { ok: true } | { ok: false; erro: string };
export type ResultadoGestaoCategoria =
  | { ok: true }
  | { ok: false; erro: string };

const CAMINHO_PAINEL = "/painel/cardapio";

/** A genérica de escrita de produto, declarada uma vez (`seguranca.md` §14). */
const MSG_SALVAR_PRODUTO = "Não foi possível salvar o produto.";

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
    return { ok: false, erro: erroDeParseProduto(parsed.error.issues) };
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
      .insert({
        ...comPrazosNoFuso(parsed.data, loja.timezone),
        loja_id: loja.id,
      });
    if (error) {
      // Inclui o 23514 dos CHECKs de desconto (issue 219): o texto cru do
      // Postgres fica no log, o lojista recebe a genérica (seguranca.md §14).
      console.error("[criarProduto]", error);
      // [261] A recusa de RN-14 (23000 + fragmento do trigger) é a ÚNICA que
      // vira frase acionável; o resto segue genérico.
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR_PRODUTO) };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[criarProduto]", e);
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR_PRODUTO) };
  }
}

export async function atualizarProduto(
  id: string,
  payload: unknown,
): Promise<ResultadoGestaoProduto> {
  // `id` chega FORA do payload e por isso escapava do zod: lixo virava ida ao
  // banco. Mesmo contrato de `atualizarCardapio` — parse ANTES de qualquer I/O.
  if (!schemaIdProduto.safeParse(id).success) {
    return { ok: false, erro: MSG_SALVAR_PRODUTO };
  }

  // 🔴 `schemaProdutoUpdate`, NÃO `schemaProduto`: no UPDATE `visibilidade` é
  // obrigatória. Com o default do INSERT, um payload sem o campo gravaria
  // `'menu'` por cima de um produto exclusivo de cardápio — o sistema mudando
  // a declaração do lojista sozinho (ver o comentário em validacoes/produto.ts).
  const parsed = schemaProdutoUpdate.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseProduto(parsed.error.issues) };
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
    // oferecemos a opção) + escopo por id E por loja_id: o mesmo cinto e
    // suspensório das actions de lote, que não delegam o escopo só à RLS.
    const { error } = await supabase
      .from("produtos")
      .update({
        ...comPrazosNoFuso(parsed.data, loja.timezone),
        loja_id: loja.id,
      })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      // Inclui o 23514 dos CHECKs de desconto (issue 219): o texto cru do
      // Postgres fica no log, o lojista recebe a genérica (seguranca.md §14).
      console.error("[atualizarProduto]", error);
      // [261] A recusa de RN-14 (23000 + fragmento do trigger) é a ÚNICA que
      // vira frase acionável; o resto segue genérico.
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR_PRODUTO) };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarProduto]", e);
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR_PRODUTO) };
  }
}

export async function removerProduto(
  id: string,
): Promise<ResultadoGestaoProduto> {
  if (!schemaIdProduto.safeParse(id).success) {
    return { ok: false, erro: "Não foi possível remover o produto." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // RLS produtos_escrita_propria impede deletar produto de outra loja; o
    // `.eq("loja_id")` explícito é a mesma defesa em profundidade das actions
    // novas — escopo não fica só na RLS.
    const { error } = await supabase
      .from("produtos")
      .delete()
      .eq("id", id)
      .eq("loja_id", loja.id);
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
  if (typeof disponivel !== "boolean") {
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }
  if (!schemaIdProduto.safeParse(id).success) {
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // Toggle escopado por id E loja_id; a RLS continua isolando por dono.
    const { error } = await supabase
      .from("produtos")
      .update({ disponivel })
      .eq("id", id)
      .eq("loja_id", loja.id);
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
  if (typeof oculto !== "boolean") {
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }
  if (!schemaIdProduto.safeParse(id).success) {
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // Toggle de VISIBILIDADE (`oculto`) escopado por id E loja_id; a RLS
    // produtos_escrita_propria continua isolando por dono. NÃO mexe em
    // `disponivel` (RN-6-b) nem em `visibilidade` (D14).
    const { error } = await supabase
      .from("produtos")
      .update({ oculto })
      .eq("id", id)
      .eq("loja_id", loja.id);
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

export async function alternarExibirImagens(
  id: string,
  exibirImagens: boolean,
): Promise<ResultadoGestaoCategoria> {
  try {
    const supabase = await createClient();
    // Toggle escopado por id; RLS categorias_escrita_propria isola por dono.
    const { error } = await supabase
      .from("categorias")
      .update({ exibir_imagens: exibirImagens })
      .eq("id", id);
    if (error) {
      console.error("[alternarExibirImagens]", error);
      return { ok: false, erro: "Não foi possível atualizar a categoria." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[alternarExibirImagens]", e);
    return { ok: false, erro: "Não foi possível atualizar a categoria." };
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

/**
 * Reordena TODAS as categorias da loja do dono, gravando `ordem` normalizada
 * 0..n-1 numa única instrução atômica (issue 175).
 *
 * Isto é AUTORIZAÇÃO, não CRUD: o payload é uma lista de ids escolhida pelo
 * cliente e a escrita é em lote. Segue o princípio de `categoriaPertenceALoja`
 * (escopo explícito por `loja_id` ALÉM da RLS) e NÃO o de `atualizarCategoria`,
 * que busca a loja do dono mas não filtra por ela.
 *
 * Onde a posse é provada: a RPC exige que `p_ids` seja a PERMUTAÇÃO COMPLETA de
 * `categorias where loja_id = p_loja_id` e confere o `row_count` do UPDATE.
 * Um id de outra loja derruba a transação inteira — nada é escrito em nenhuma
 * das duas lojas. Isso substitui um SELECT de posse prévio em JS de propósito:
 * o pre-check em JS seria TOCTOU (a lista pode mudar entre o SELECT e o UPDATE),
 * a checagem dentro da transação não é.
 *
 * `p_loja_id` vem SEMPRE de `buscarLojaDoDono` (auth.uid()), NUNCA do payload.
 */
export async function reordenarCategorias(
  payload: unknown,
): Promise<ResultadoGestaoCategoria> {
  // 1) Forma ANTES de qualquer I/O: array de uuid, sem duplicata, 2..200.
  //    O parse devolve um array NOVO — propriedade hostil pendurada no array do
  //    cliente (ex.: `loja_id`) não sobrevive e nunca chega aos args da RPC.
  const parsed = schemaReordenacaoCategorias.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Não foi possível salvar a ordem." };
  }

  try {
    // 2) Client AUTENTICADO — a RLS categorias_escrita_propria isola por dono.
    //    `security invoker` na RPC mantém essa RLS valendo lá dentro.
    const supabase = await createClient();
    // 3) loja_id DERIVADO do auth.uid(), NUNCA do payload.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    // 4) UMA ida ao banco, UMA instrução, atômica.
    const { error } = await supabase.rpc("reordenar_categorias", {
      p_loja_id: loja.id,
      p_ids: parsed.data,
    });
    if (error) {
      // Mensagem única para id alheio / lista incompleta / erro de banco:
      // mensagens distintas virariam oráculo de existência de id (§14).
      console.error("[reordenarCategorias]", error);
      return { ok: false, erro: "Não foi possível salvar a ordem." };
    }

    // NÃO usa CAMINHO_PAINEL: "/painel/cardapio" não existe como rota (achado
    // pré-existente — os revalidatePath que o usam são no-op). Aqui vão os
    // caminhos REAIS, incluindo o da vitrine, que herda a ordem de
    // `buscarCategorias`. A vitrine vai pelo slug da PRÓPRIA loja, não pela
    // forma coringa `("/loja/[slug]", "page")`: aquela invalida o Router Cache
    // da vitrine de TODAS as lojas do marketplace a cada reordenação.
    revalidatePath("/painel/produtos");
    revalidatePath(`/loja/${loja.slug}`);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarCategorias]", e);
    return { ok: false, erro: "Não foi possível salvar a ordem." };
  }
}

/**
 * [261] D14 em LOTE — a declaração de `visibilidade` para N produtos de uma
 * vez. É o MESMO campo, o MESMO domínio (`visibilidadeProduto`) e a MESMA
 * recusa legível (`erroDeEscritaDeProduto`) que o `FormProduto` usa ao salvar
 * um produto: a barra de ação não tem uma segunda regra de D14.
 *
 * 🔴 Por que UMA instrução para a lista inteira, e não um UPDATE por id:
 *  - tudo ou nada. O trigger de RN-14 é DEFERIDO e só recusa no COMMIT; um
 *    UPDATE por id gravaria os bons, falharia num deles e deixaria o lojista
 *    com metade do lote aplicada e nenhuma forma de saber qual metade;
 *  - anti-oráculo (`seguranca.md` §14). O `.eq("loja_id")` explícito, além da
 *    RLS `produtos_escrita_propria`, faz id de outra loja e id inexistente
 *    caírem no MESMO lugar: nenhuma linha casa e a resposta é byte a byte a
 *    mesma. Nenhuma contagem de "ignorados" volta ao cliente.
 *
 * `visibilidade` é a ÚNICA coluna escrita — o sistema nunca mexe em nada mais
 * do produto aqui, e nunca muda `visibilidade` por conta própria: converter é
 * gesto do lojista, sempre.
 */
export async function definirVisibilidadeEmProdutos(
  payload: unknown,
): Promise<ResultadoGestaoProduto> {
  const parsed = schemaVisibilidadeEmLote.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: MSG_SALVAR_PRODUTO };
  }
  const { produto_ids, visibilidade } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: "Loja não encontrada." };

    const { error } = await supabase
      .from("produtos")
      .update({ visibilidade })
      .eq("loja_id", loja.id)
      .in("id", produto_ids);
    if (error) {
      console.error("[definirVisibilidadeEmProdutos]", error);
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR_PRODUTO) };
    }

    // Os três caminhos REAIS (RN-11), como em `lib/actions/cardapio.ts`:
    // `CAMINHO_PAINEL` acima aponta para uma rota que não existe (débito
    // conhecido, `architecture.md` §10) e não é reusado aqui de propósito.
    revalidatePath("/painel/produtos");
    revalidatePath("/painel/cardapios");
    revalidatePath(`/loja/${loja.slug}`);
    return { ok: true };
  } catch (e) {
    console.error("[definirVisibilidadeEmProdutos]", e);
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR_PRODUTO) };
  }
}
