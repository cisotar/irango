"use server";

/**
 * Variantes ADMIN do CRUD de opcionais (biblioteca + associação) — issue 135
 * (crítica: SIM). Escrevem na LOJA-ALVO (`lojaId` explícito vindo da URL admin),
 * via service_role, escopadas pelo wrapper `escopo` de admin-loja.ts (injeta
 * `eq("loja_id", lojaId)` +`eq("id")` por construção). Diferente do CRUD do
 * lojista (src/lib/actions/opcional.ts), o isolamento NÃO vem de RLS por dono
 * (service_role a bypassa) — vem do escopo do wrapper e da prova de posse das
 * referências (categoria_opcional_id / categoria_id) sob `lojaId` (RN-O8).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) + schema*.safeParse(payload) ANTES de efeito;
 *     preço negativo é reprovado por schemaOpcional (≥0) sem tocar no banco.
 *  2. verificarAdminSaaS() (dentro de prepararContextoAdmin) FORA do try →
 *     exceção PROPAGA, service_role só criado depois.
 *  3. Posse de categoria_opcional_id / categoria_id provada via
 *     escopo.buscarPorId (SELECT escopado por loja) ANTES de gravar.
 *  4. INSERT/UPDATE/DELETE/toggle via `escopo.*` (loja_id +id); loja_id gravado =
 *     lojaId, NUNCA do payload (injetado por último pelo wrapper).
 *  5. revalidarLojaAdmin; registrarAcessoAdmin (best-effort: INSERT em admin_acessos); catch genérico (seguranca.md §14).
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import {
  schemaCategoriaOpcional,
  schemaOpcional,
  schemaAssociacaoCategoriaOpcional,
} from "@/lib/validacoes/opcional";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  type EscopoLoja,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Descarta APENAS `loja_id` de um payload-objeto antes do parse. O escopo por
 * tenant é do `lojaId` da URL (injetado por `escopo.inserir`), então um `loja_id`
 * hostil no payload não pode re-parentear a linha — é removido aqui em vez de
 * fazer o schema `.strict()` reprovar o request inteiro. Demais campos extras
 * seguem barrados pelo `.strict()` (defesa contra payload arbitrário).
 */
function descartarLojaId(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") return payload;
  const { loja_id: _descartado, ...resto } = payload as Record<string, unknown>;
  return resto;
}

/**
 * Confere que `categoriaOpcionalId` pertence à LOJA-ALVO. Sem RLS por dono aqui
 * (service_role a contorna), a posse é provada por SELECT escopado do wrapper
 * (loja_id + id). Categoria alheia/inexistente → false (RN-O8, anti cross-loja).
 */
async function categoriaOpcionalPertenceALoja(
  escopo: EscopoLoja,
  categoriaOpcionalId: string,
): Promise<boolean> {
  const { data, error } = await escopo.buscarPorId(
    "opcionais_categorias",
    categoriaOpcionalId,
    "id",
  );
  if (error) throw error;
  return data != null;
}

/** Confere que `categoriaId` (de PRODUTO) pertence à LOJA-ALVO. */
async function categoriaProdutoPertenceALoja(
  escopo: EscopoLoja,
  categoriaId: string,
): Promise<boolean> {
  const { data, error } = await escopo.buscarPorId("categorias", categoriaId, "id");
  if (error) throw error;
  return data != null;
}

// ── Categorias de opcional ────────────────────────────────────────────────

export async function criarCategoriaOpcionalAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaCategoriaOpcional.safeParse(descartarLojaId(payload));
  if (!parsed.success) {
    return { ok: false, erro: "Categoria de opcional inválida." };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // loja_id = lojaId da URL, injetado por último pelo wrapper (nunca do payload).
    const { error } = await escopo.inserir("opcionais_categorias", parsed.data);
    if (error) {
      console.error("[criarCategoriaOpcionalAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar a categoria." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.categoria.criar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarCategoriaOpcionalAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar a categoria." };
  }
}

export async function atualizarCategoriaOpcionalAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaCategoriaOpcional.safeParse(descartarLojaId(payload));
  if (!parsed.success) {
    return { ok: false, erro: "Categoria de opcional inválida." };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja (loja_id + id) pelo wrapper; loja_id não vai no patch.
    const { error } = await escopo.atualizar("opcionais_categorias", id, parsed.data);
    if (error) {
      console.error("[atualizarCategoriaOpcionalAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar a categoria." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.categoria.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCategoriaOpcionalAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar a categoria." };
  }
}

export async function removerCategoriaOpcionalAdmin(
  lojaId: string,
  id: string,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja (loja_id + id); FK ON DELETE CASCADE remove opcionais e
    // associações dependentes.
    const { error } = await escopo.remover("opcionais_categorias", id);
    if (error) {
      console.error("[removerCategoriaOpcionalAdmin]", error);
      return { ok: false, erro: "Não foi possível remover a categoria." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.categoria.remover",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerCategoriaOpcionalAdmin]", e);
    return { ok: false, erro: "Não foi possível remover a categoria." };
  }
}

// ── Opcionais (itens da biblioteca) ─────────────────────────────────────────

export async function criarOpcionalAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // Preço negativo é reprovado por schemaOpcional (≥0) sem tocar no banco.
  const parsed = schemaOpcional.safeParse(descartarLojaId(payload));
  if (!parsed.success) return { ok: false, erro: "Opcional inválido." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Posse da categoria de opcional sob lojaId (RN-O8) ANTES de inserir.
    const pertence = await categoriaOpcionalPertenceALoja(
      escopo,
      parsed.data.categoria_opcional_id,
    );
    if (!pertence) return { ok: false, erro: "Categoria de opcional inválida." };

    // loja_id = lojaId da URL, injetado por último pelo wrapper (nunca do payload).
    const { error } = await escopo.inserir("opcionais", parsed.data);
    if (error) {
      console.error("[criarOpcionalAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar o opcional." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.criar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarOpcionalAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar o opcional." };
  }
}

export async function atualizarOpcionalAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaOpcional.safeParse(descartarLojaId(payload));
  if (!parsed.success) return { ok: false, erro: "Opcional inválido." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Posse da (nova) categoria de opcional sob lojaId (RN-O8) ANTES de gravar.
    const pertence = await categoriaOpcionalPertenceALoja(
      escopo,
      parsed.data.categoria_opcional_id,
    );
    if (!pertence) return { ok: false, erro: "Categoria de opcional inválida." };

    // Escopo cross-loja (loja_id + id) pelo wrapper; loja_id não vai no patch.
    const { error } = await escopo.atualizar("opcionais", id, parsed.data);
    if (error) {
      console.error("[atualizarOpcionalAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar o opcional." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarOpcionalAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar o opcional." };
  }
}

export async function alternarOpcionalAtivoAdmin(
  lojaId: string,
  id: string,
  ativo: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Toggle escopado por id E loja_id (cross-loja) pelo wrapper.
    const { error } = await escopo.atualizar("opcionais", id, { ativo });
    if (error) {
      console.error("[alternarOpcionalAtivoAdmin]", error);
      return { ok: false, erro: "Não foi possível atualizar o opcional." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.disponibilidade",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[alternarOpcionalAtivoAdmin]", e);
    return { ok: false, erro: "Não foi possível atualizar o opcional." };
  }
}

export async function removerOpcionalAdmin(
  lojaId: string,
  id: string,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja: DELETE alcança só opcional da loja-alvo. Pedidos passados
    // não são afetados (snapshot em itens_pedido_opcionais, RN-O6).
    const { error } = await escopo.remover("opcionais", id);
    if (error) {
      console.error("[removerOpcionalAdmin]", error);
      return { ok: false, erro: "Não foi possível remover o opcional." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.remover",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerOpcionalAdmin]", e);
    return { ok: false, erro: "Não foi possível remover o opcional." };
  }
}

// ── Associação categoria-de-produto ⋈ categorias-de-opcional ─────────────────

/**
 * Grava em LOTE quais categorias de opcional ficam disponíveis para uma categoria
 * de PRODUTO na LOJA-ALVO. Idempotente: substitui o conjunto atual pela seleção.
 *
 * RN-O8: ambas as pontas (categoria de produto e cada categoria de opcional) são
 * provadas como da LOJA-ALVO via escopo.buscarPorId ANTES de qualquer escrita —
 * service_role não checa a posse das FKs referenciadas; a barreira é o SELECT
 * escopado.
 */
export async function salvarAssociacaoOpcionaisAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaAssociacaoCategoriaOpcional.safeParse(descartarLojaId(payload));
  if (!parsed.success) return { ok: false, erro: "Associação inválida." };

  const { categoria_id, categoria_opcional_id } = parsed.data;

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Ponta 1: categoria de PRODUTO da LOJA-ALVO.
    const produtoOk = await categoriaProdutoPertenceALoja(escopo, categoria_id);
    if (!produtoOk) return { ok: false, erro: "Categoria de produto inválida." };

    // Ponta 2: cada categoria de OPCIONAL selecionada da LOJA-ALVO (RN-O8).
    for (const catOpcId of categoria_opcional_id) {
      const opcOk = await categoriaOpcionalPertenceALoja(escopo, catOpcId);
      if (!opcOk) return { ok: false, erro: "Categoria de opcional inválida." };
    }

    // Substituição de conjunto: DELETE-por-categoria_id. EXCEÇÃO DOCUMENTADA ao
    // wrapper `escopo` (que só remove por PK: .eq("loja_id").eq("id")). Aqui o
    // filtro é por categoria_id, não por id — `svc` cru com escopo manual
    // EXPLÍCITO .eq("loja_id", lojaId).eq("categoria_id", …), mesma categoria das
    // exceções legítimas de admin-loja.ts (todo .delete() carrega .eq).
    const { error: erroDelete } = await svc
      .from("categoria_produto_opcionais")
      .delete()
      .eq("loja_id", loja.lojaId)
      .eq("categoria_id", categoria_id);
    if (erroDelete) {
      console.error("[salvarAssociacaoOpcionaisAdmin:delete]", erroDelete);
      return { ok: false, erro: "Não foi possível salvar a associação." };
    }

    // INSERT NÃO é exceção: loop via escopo.inserir (loja_id injetado pelo wrapper),
    // evitando uma segunda escrita crua. Lista vazia → nenhum INSERT roda.
    for (const catOpcId of categoria_opcional_id) {
      const { error: erroInsert } = await escopo.inserir("categoria_produto_opcionais", {
        categoria_id,
        categoria_opcional_id: catOpcId,
      });
      if (erroInsert) {
        console.error("[salvarAssociacaoOpcionaisAdmin:insert]", erroInsert);
        return { ok: false, erro: "Não foi possível salvar a associação." };
      }
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.associacao.salvar",
      entidadeId: categoria_id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[salvarAssociacaoOpcionaisAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar a associação." };
  }
}
