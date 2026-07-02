"use server";

/**
 * Variantes ADMIN do CRUD de produtos — issue 089 (crítica: SIM). Escrevem na
 * LOJA-ALVO (`lojaId` explícito vindo da URL admin), via service_role, escopadas
 * pelo wrapper `escopo` (injeta `eq("loja_id", lojaId)` +`eq("id")` por
 * construção). Diferente do CRUD do lojista (src/lib/actions/produto.ts), o
 * isolamento NÃO vem de RLS por dono — vem do escopo do wrapper e da validação de
 * posse da categoria sob `lojaId` (seguranca.md §2/§14, spec RN-1/2/3/6).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) + schemaProduto.safeParse(payload) ANTES de efeito;
 *     preço negativo é reprovado pelo zod (RN-6) sem tocar no banco.
 *  2. verificarAdminSaaS() FORA do try → exceção PROPAGA, service só depois.
 *  3. Se categoria_id informado: SELECT escopado por loja (posse); não achou →
 *     { ok:false } sem gravar.
 *  4. INSERT/UPDATE/DELETE/toggle em `produtos` via `escopo.*` (loja_id +id);
 *     loja_id gravado = lojaId, NUNCA do payload (injetado por último).
 *  5. revalidatePath admin + vitrine; registrarAcessoAdmin no-op; catch genérico.
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import { schemaProduto } from "@/lib/validacoes/produto";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  type EscopoLoja,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Confere que `categoriaId` pertence à LOJA-ALVO. Sem RLS por dono aqui (service_
 * role contorna RLS), a posse é provada por SELECT escopado do wrapper (loja_id +
 * id). Categoria alheia/inexistente → false (rejeita antes de gravar).
 */
async function categoriaPertenceALoja(
  escopo: EscopoLoja,
  categoriaId: string,
): Promise<boolean> {
  const { data, error } = await escopo.buscarPorId("categorias", categoriaId, "id");
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
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(escopo, parsed.data.categoria_id);
      if (!pertence) return { ok: false, erro: "Categoria inválida." };
    }

    // loja_id = lojaId da URL, injetado por último pelo wrapper (nunca do payload).
    const { error } = await escopo.inserir("produtos", parsed.data);
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

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(escopo, parsed.data.categoria_id);
      if (!pertence) return { ok: false, erro: "Categoria inválida." };
    }

    // Escopo cross-loja (loja_id + id) pelo wrapper; loja_id não vai no patch.
    const { error } = await escopo.atualizar("produtos", id, parsed.data);
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

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja: DELETE alcança só produto da loja-alvo.
    const { error } = await escopo.remover("produtos", id);
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

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Toggle escopado por id E loja_id (cross-loja) pelo wrapper.
    const { error } = await escopo.atualizar("produtos", id, { disponivel });
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

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // UPDATE por linha escopado por id E loja_id da URL (nunca payload): a escrita
    // nunca atravessa para outra loja, e só mexe na coluna `ordem`.
    for (const o of ordem) {
      const { error } = await escopo.atualizar("produtos", o.id, { ordem: o.ordem });
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
