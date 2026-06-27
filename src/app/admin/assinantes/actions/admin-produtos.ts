"use server";

/**
 * Variantes ADMIN do CRUD de produtos — issue 089 (crítica: SIM). Escrevem na
 * LOJA-ALVO (`lojaId` explícito vindo da URL admin), via service_role, escopadas
 * por `eq("loja_id", lojaId)` em TODA escrita. Diferente do CRUD do lojista
 * (src/lib/actions/produto.ts), o isolamento NÃO vem de RLS por dono — vem do
 * escopo manual `eq("loja_id", lojaId)` e da validação de posse da categoria sob
 * `lojaId` (seguranca.md §2/§14, spec admin-onboarding-assistido.md RN-1/2/3/6).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) + schemaProduto.safeParse(payload) ANTES de efeito;
 *     preço negativo é reprovado pelo zod (RN-6) sem tocar no banco.
 *  2. verificarAdminSaaS() FORA do try → exceção PROPAGA, service só depois.
 *  3. Se categoria_id informado: SELECT em `categorias` escopado por loja_id =
 *     lojaId (posse); não achou → { ok:false } sem gravar.
 *  4. INSERT/UPDATE/DELETE/toggle em `produtos` com eq("loja_id", lojaId) (+ id);
 *     loja_id gravado = lojaId, NUNCA do payload.
 *  5. revalidatePath admin + vitrine; registrarAcessoAdmin no-op; catch genérico.
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import { schemaProduto } from "@/lib/validacoes/produto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Confere que `categoriaId` pertence à LOJA-ALVO. Sem RLS por dono aqui (service_
 * role contorna RLS), a posse é provada por SELECT escopado em loja_id = lojaId.
 * Categoria alheia/inexistente → false (rejeita antes de gravar).
 */
async function categoriaPertenceALoja(
  svc: ServiceClient,
  categoriaId: string,
  lojaId: string,
): Promise<boolean> {
  const { data, error } = await svc
    .from("categorias")
    .select("id")
    .eq("id", categoriaId)
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

export async function criarProdutoAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaProduto.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Produto inválido." };

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(
        svc,
        parsed.data.categoria_id,
        loja.lojaId,
      );
      if (!pertence) return { ok: false, erro: "Categoria inválida." };
    }

    // loja_id = lojaId da URL, NUNCA do payload (parsed.data não tem loja_id).
    const { error } = await svc
      .from("produtos")
      .insert({ ...parsed.data, loja_id: loja.lojaId });
    if (error) {
      console.error("[criarProdutoAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar o produto." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.criar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarProdutoAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar o produto." };
  }
}

export async function atualizarProdutoAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaProduto.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Produto inválido." };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(
        svc,
        parsed.data.categoria_id,
        loja.lojaId,
      );
      if (!pertence) return { ok: false, erro: "Categoria inválida." };
    }

    // Escopo cross-loja: id E loja_id; loja_id reafirmado = lojaId, nunca payload.
    const { error } = await svc
      .from("produtos")
      .update({ ...parsed.data, loja_id: loja.lojaId })
      .eq("id", id)
      .eq("loja_id", loja.lojaId);
    if (error) {
      console.error("[atualizarProdutoAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar o produto." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarProdutoAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar o produto." };
  }
}

export async function removerProdutoAdmin(
  lojaId: string,
  id: string,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja: DELETE alcança só produto da loja-alvo.
    const { error } = await svc
      .from("produtos")
      .delete()
      .eq("id", id)
      .eq("loja_id", loja.lojaId);
    if (error) {
      console.error("[removerProdutoAdmin]", error);
      return { ok: false, erro: "Não foi possível remover o produto." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.remover",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerProdutoAdmin]", e);
    return { ok: false, erro: "Não foi possível remover o produto." };
  }
}

export async function alternarDisponibilidadeAdmin(
  lojaId: string,
  id: string,
  disponivel: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Toggle escopado por id E loja_id (cross-loja).
    const { error } = await svc
      .from("produtos")
      .update({ disponivel })
      .eq("id", id)
      .eq("loja_id", loja.lojaId);
    if (error) {
      console.error("[alternarDisponibilidadeAdmin]", error);
      return { ok: false, erro: "Não foi possível atualizar o produto." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.disponibilidade",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[alternarDisponibilidadeAdmin]", e);
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }
}

export async function reordenarProdutosAdmin(
  lojaId: string,
  ordem: { id: string; ordem: number }[],
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // UPDATE por linha escopado por id E loja_id da URL (nunca payload): a escrita
    // nunca atravessa para outra loja, e só mexe na coluna `ordem` (sem exigir os
    // NOT NULL nome/preco de um upsert/insert).
    for (const o of ordem) {
      const { error } = await svc
        .from("produtos")
        .update({ ordem: o.ordem })
        .eq("id", o.id)
        .eq("loja_id", loja.lojaId);
      if (error) {
        console.error("[reordenarProdutosAdmin]", error);
        return { ok: false, erro: "Não foi possível reordenar os produtos." };
      }
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.reordenar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarProdutosAdmin]", e);
    return { ok: false, erro: "Não foi possível reordenar os produtos." };
  }
}
