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
  schemaReordenacaoOpcionaisDaCategoria,
  schemaReordenacaoItensDoGrupo,
} from "@/lib/validacoes/opcional";
import { planejarAssociacaoOpcionais } from "@/lib/utils/associacao-opcionais";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  type EscopoLoja,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Mensagem ÚNICA para loja inválida, payload inválido, id alheio, lista
 * incompleta e erro de banco (seguranca.md §14): mensagem distinta viraria
 * oráculo de existência de id. O detalhe fica no console.error do servidor.
 */
const ERRO_ORDEM_ADMIN = "Não foi possível salvar a ordem.";

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

    // RN-12: NÃO substitui o conjunto inteiro. O delete+insert de tudo zeraria
    // `categoria_produto_opcionais.ordem` (default 0) a cada clique de checkbox.
    // MESMA regra do lojista, pela MESMA função pura — nada é duplicado aqui.
    //
    // SELECT e DELETE por `categoria_id` são EXCEÇÃO DOCUMENTADA ao wrapper
    // `escopo` (que só opera por PK: .eq("loja_id").eq("id")): `svc` cru com
    // escopo manual EXPLÍCITO .eq("loja_id", lojaId).eq("categoria_id", …),
    // mesma categoria das exceções legítimas de admin-loja.ts.
    const { data: associados, error: erroLeitura } = await svc
      .from("categoria_produto_opcionais")
      .select("categoria_opcional_id, ordem")
      .eq("loja_id", loja.lojaId)
      .eq("categoria_id", categoria_id);
    if (erroLeitura) {
      console.error("[salvarAssociacaoOpcionaisAdmin:select]", erroLeitura);
      return { ok: false, erro: "Não foi possível salvar a associação." };
    }

    const plano = planejarAssociacaoOpcionais(associados ?? [], categoria_opcional_id);

    if (plano.remover.length > 0) {
      const { error: erroDelete } = await svc
        .from("categoria_produto_opcionais")
        .delete()
        .eq("loja_id", loja.lojaId)
        .eq("categoria_id", categoria_id)
        .in("categoria_opcional_id", plano.remover);
      if (erroDelete) {
        console.error("[salvarAssociacaoOpcionaisAdmin:delete]", erroDelete);
        return { ok: false, erro: "Não foi possível salvar a associação." };
      }
    }

    // INSERT NÃO é exceção: loop via escopo.inserir (loja_id injetado pelo wrapper),
    // evitando uma segunda escrita crua. Plano vazio → nenhum INSERT roda.
    for (const linha of plano.inserir) {
      const { error: erroInsert } = await escopo.inserir("categoria_produto_opcionais", {
        categoria_id,
        categoria_opcional_id: linha.categoria_opcional_id,
        ordem: linha.ordem,
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

// ── Reordenação dos grupos de opcional dentro de uma categoria de produto ────

/**
 * Variante ADMIN de `reordenarOpcionaisDaCategoria` (issue 208), escopada pela
 * LOJA-ALVO da URL admin.
 *
 * REUSA a RPC `reordenar_opcionais_da_categoria` desde a issue 215, que a tornou
 * `security definer` e fechou o débito 211. Antes disso não dava: a função era
 * `security invoker` e a RLS do lojista (`lojas.dono_id = auth.uid()`) não vale
 * para o admin do SaaS, então sob `service_role` a permutação seria checada
 * contra um conjunto que a RLS não filtra — e esta action gravava a ordem num
 * LOOP de N `update` FORA de transação, deixando posições parciais quando uma
 * falha caía no meio.
 *
 * Agora a autoridade mora no corpo da função: a trava T2 aceita a via de
 * serviço, e a T3 exige coerência loja↔categoria de produto INCLUSIVE sob
 * `service_role`. O isolamento por tenant continua sendo o `p_loja_id`, que vem
 * SEMPRE de `validarLojaIdAdmin(lojaId)` (a URL admin), NUNCA do payload.
 *
 * Fail-closed igual ao caminho do lojista: a lista tem que ser a PERMUTAÇÃO
 * COMPLETA do par (loja-alvo, categoria de produto). Subconjunto, id alheio ou
 * duplicado → a transação inteira cai, nenhuma escrita. O `count: "exact"` que o
 * loop precisava ficou desnecessário: contagem e `update` rodam na MESMA
 * transação, então a janela TOCTOU não existe mais.
 */
export async function reordenarOpcionaisDaCategoriaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_ORDEM_ADMIN };

  const parsed = schemaReordenacaoOpcionaisDaCategoria.safeParse(descartarLojaId(payload));
  if (!parsed.success) return { ok: false, erro: ERRO_ORDEM_ADMIN };

  const { categoria_id, categoria_opcional_id } = parsed.data;

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // A categoria de PRODUTO veio do cliente: provar que é da LOJA-ALVO (RN-5b).
    const produtoOk = await categoriaProdutoPertenceALoja(escopo, categoria_id);
    if (!produtoOk) return { ok: false, erro: ERRO_ORDEM_ADMIN };

    // UMA ida ao banco, UMA instrução, atômica. `ordem` é DERIVADA de
    // `ordinality - 1` dentro da RPC — o cliente só mandou a sequência.
    const { error } = await svc.rpc("reordenar_opcionais_da_categoria", {
      p_loja_id: loja.lojaId,
      p_categoria_id: categoria_id,
      p_ids: categoria_opcional_id,
    });
    if (error) {
      console.error("[reordenarOpcionaisDaCategoriaAdmin:rpc]", error);
      return { ok: false, erro: ERRO_ORDEM_ADMIN };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "reordenar_opcionais_da_categoria",
      entidadeId: categoria_id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarOpcionaisDaCategoriaAdmin]", e);
    return { ok: false, erro: ERRO_ORDEM_ADMIN };
  }
}

// ── Reordenação dos ITENS dentro de um grupo de opcional (issue 215) ─────────

/**
 * Variante ADMIN de `reordenarItensDoGrupoOpcional`, escopada pela LOJA-ALVO da
 * URL admin. Espelho exato da via do lojista: as duas gravam a MESMA coluna com
 * a MESMA regra, pela MESMA RPC — a única diferença é de onde vem a loja
 * (`auth.uid()` lá, `lojaId` da URL aqui).
 *
 * `p_loja_id` vem SEMPRE de `validarLojaIdAdmin(lojaId)`, NUNCA do payload: sob
 * `service_role` a RLS não filtra nada e a trava T2 reconhece a via de serviço,
 * então o valor deste argumento é o ÚNICO escopo de tenant que resta. O
 * `categoria_opcional_id` (do cliente) é provado como da LOJA-ALVO por SELECT
 * escopado antes da RPC, e a trava T3 confere a mesma coerência dentro da
 * transação.
 */
export async function reordenarItensDoGrupoOpcionalAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_ORDEM_ADMIN };

  const parsed = schemaReordenacaoItensDoGrupo.safeParse(descartarLojaId(payload));
  if (!parsed.success) return { ok: false, erro: ERRO_ORDEM_ADMIN };

  const { categoria_opcional_id, opcional_id } = parsed.data;

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // O grupo veio do cliente: provar que é da LOJA-ALVO (RN-O8).
    const grupoOk = await categoriaOpcionalPertenceALoja(escopo, categoria_opcional_id);
    if (!grupoOk) return { ok: false, erro: ERRO_ORDEM_ADMIN };

    // UMA ida ao banco, UMA instrução, atômica. A SEQUÊNCIA do payload é o dado:
    // `p_ids` vai na ordem recebida; `ordem` é derivada de `ordinality - 1`.
    const { error } = await svc.rpc("reordenar_itens_do_grupo_opcional", {
      p_loja_id: loja.lojaId,
      p_categoria_opcional_id: categoria_opcional_id,
      p_ids: opcional_id,
    });
    if (error) {
      console.error("[reordenarItensDoGrupoOpcionalAdmin:rpc]", error);
      return { ok: false, erro: ERRO_ORDEM_ADMIN };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "opcional.item.reordenar",
      entidadeId: categoria_opcional_id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[reordenarItensDoGrupoOpcionalAdmin]", e);
    return { ok: false, erro: ERRO_ORDEM_ADMIN };
  }
}
