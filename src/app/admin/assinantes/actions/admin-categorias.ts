"use server";

// GREEN (issue 088, crítica: SIM) — Server Actions ADMIN do CRUD de categorias.
// Escrevem na loja-alvo (`lojaId` explícito vindo da URL admin), via service_role,
// SEMPRE escopadas por eq("loja_id", lojaId) (+ eq("id", id) em update/delete).
// Padrão fail-closed espelhando o contrato do teste admin-categorias.test.ts:
//   validarLojaIdAdmin(lojaId) → schemaCategoria.safeParse (onde aplicável) →
//   verificarAdminSaaS() FORA do try (propaga, D-4) → createServiceClient() →
//   escrita escopada com { count:"exact" } → count 0 → "Categoria não encontrada."
//   → revalidatePath (admin cardápio + vitrine) → registrarAcessoAdmin (no-op) →
//   catch genérico.
//
// `loja_id` gravado é SEMPRE o parâmetro `lojaId`, NUNCA o do payload (que pode
// ser hostil). Tipos auxiliares ficam locais (módulo 'use server' só exporta
// funções async).

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { schemaCategoria } from "@/lib/validacoes/produto";

type ResultadoCategoriaAdmin = { ok: true } | { ok: false; erro: string };

const ERRO_GENERICO = "Não foi possível concluir a operação.";

export async function criarCategoriaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoCategoriaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaCategoria.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Dados inválidos." };

  // Fora do try: se a prova de admin falha, PROPAGA (fail-closed, D-4) e o
  // service client nunca é criado.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // `escopo.inserir` injeta `loja_id` autoritativo (parâmetro) por último —
    // impossível o payload sobrescrever o escopo.
    const { error } = await escopo.inserir("categorias", {
      nome: parsed.data.nome,
      ordem: parsed.data.ordem,
    });
    if (error) return { ok: false, erro: ERRO_GENERICO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "criar_categoria",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarCategoriaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export async function atualizarCategoriaAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<ResultadoCategoriaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaCategoria.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Dados inválidos." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error, count } = await escopo.atualizar("categorias", id, {
      nome: parsed.data.nome,
      ordem: parsed.data.ordem,
    });
    if (error) return { ok: false, erro: ERRO_GENERICO };
    if (!count) return { ok: false, erro: "Categoria não encontrada." };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "atualizar_categoria",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCategoriaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export async function removerCategoriaAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoCategoriaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error, count } = await escopo.remover("categorias", id);
    if (error) return { ok: false, erro: ERRO_GENERICO };
    if (!count) return { ok: false, erro: "Categoria não encontrada." };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "remover_categoria",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerCategoriaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export async function reordenarCategoriasAdmin(
  lojaId: string,
  ordem: { id: string; ordem: number }[],
): Promise<ResultadoCategoriaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    for (const item of ordem) {
      // TODA escrita carrega o escopo da loja-alvo (via wrapper).
      const { error } = await escopo.atualizar("categorias", item.id, { ordem: item.ordem });
      if (error) return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "reordenar_categorias",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarCategoriasAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
