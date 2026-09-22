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
 *     loja_id gravado = lojaId, NUNCA do payload (injetado por último). Prazo de
 *     promoção convertido pelo fuso da LOJA-ALVO (RN-03) antes de gravar.
 *  5. revalidatePath admin + vitrine; registrarAcessoAdmin (best-effort: INSERT em admin_acessos); catch genérico.
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import {
  schemaProduto,
  schemaProdutoUpdate,
  schemaVisibilidadeEmLote,
  schemaIdProduto,
  schemaNomeEPreco,
  validarPrecoContraDesconto,
} from "@/lib/validacoes/produto";
// Contrato NEUTRO compartilhado com o caminho do LOJISTA (issue 241): a mensagem
// de D10 e a conversão de prazo pelo fuso têm UMA fonte nos dois mundos — o
// admin escreve com service_role (BYPASSRLS), então a paridade É a proteção.
import {
  erroDeParseProduto,
  comPrazosNoFuso,
  erroDeEscritaDeProduto,
  type DadosProduto,
} from "@/lib/actions/produto-contrato";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  type EscopoLoja,
} from "@/lib/actions/admin-loja";
import { buscarLojaAdminPorId } from "@/lib/supabase/queries/lojas";

type Resultado = { ok: true } | { ok: false; erro: string };

/** A genérica de escrita de produto (`seguranca.md` §14), declarada uma vez. */
const MSG_SALVAR = "Não foi possível salvar o produto.";

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

/**
 * RN-03 no hub admin, pela MESMA `comPrazosNoFuso` do lojista: o fuso que
 * converte o prazo digitado vem da LOJA-ALVO (`lojas.timezone`, lido por
 * `lojaId` da URL), NUNCA do payload — o admin edita em nome do lojista e a
 * promoção vale no fuso da loja dele. Só vai ao banco quando há prazo a
 * converter (sem promoção com data, nenhum roundtrip). Loja-alvo sem linha →
 * `null`, e a action recusa sem gravar.
 */
async function comPrazosDaLojaAlvo(
  svc: Parameters<typeof registrarAcessoAdmin>[0],
  lojaId: string,
  dados: DadosProduto,
): Promise<DadosProduto | null> {
  const temPrazo =
    typeof dados.desconto_inicio === "string" ||
    typeof dados.desconto_fim === "string";
  if (!temPrazo) return dados;
  const loja = await buscarLojaAdminPorId(svc, lojaId);
  if (loja == null) return null;
  return comPrazosNoFuso(dados, loja.timezone);
}

export async function criarProdutoAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaProduto.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseProduto(parsed.error.issues) };
  }

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(escopo, parsed.data.categoria_id);
      if (!pertence) return { ok: false, erro: "Categoria inválida." };
    }

    // RN-03: prazo em hora local → instante no fuso da LOJA-ALVO.
    const dados = await comPrazosDaLojaAlvo(svc, loja.lojaId, parsed.data);
    if (dados == null) return { ok: false, erro: "Loja não encontrada." };

    // loja_id = lojaId da URL, injetado por último pelo wrapper (nunca do payload).
    const { error } = await escopo.inserir("produtos", dados);
    if (error) {
      console.error("[criarProdutoAdmin]", error);
      // [261] Paridade com o caminho do lojista: a recusa de RN-14 vira frase
      // acionável (o trigger é SECURITY DEFINER e vale sob `service_role`), o
      // resto segue genérico.
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR) };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.criar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarProdutoAdmin]", e);
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR) };
  }
}

/**
 * [290] O desconto JÁ GRAVADO da linha, lido pelo escopo (loja-alvo + id). O
 * wrapper devolve `data: unknown` (os generics do PostgREST não estreitam ali),
 * então a forma é conferida aqui — sem `any` e sem confiar no payload.
 */
type DescontoGravado = { tipo: string | null; valor: number | null };

function descontoGravado(data: unknown): DescontoGravado | null {
  if (data == null || typeof data !== "object") return null;
  const linha = data as Record<string, unknown>;
  return {
    tipo: typeof linha.desconto_tipo === "string" ? linha.desconto_tipo : null,
    valor:
      typeof linha.desconto_valor === "number" ? linha.desconto_valor : null,
  };
}

/**
 * [290] PARIDADE da edição inline de nome+preço. O hub admin escreve com
 * `service_role` (BYPASSRLS): nenhuma regra que more só na RLS protege esta
 * via, e o CHECK de desconto protege o DADO, não a MENSAGEM. O que protege a
 * UX aqui é a paridade com `atualizarNomeEPreco` do lojista — mesma
 * `validarPrecoContraDesconto`, mesma frase de D10 (uma fonte só, nenhum texto
 * literal aqui), mesmo patch de DUAS chaves, mesma recusa antes do I/O.
 */
export async function atualizarNomeEPrecoAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  if (!schemaIdProduto.safeParse(id).success) {
    return { ok: false, erro: MSG_SALVAR };
  }
  const parsed = schemaNomeEPreco.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseProduto(parsed.error.issues) };
  }

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Releitura ESCOPADA do desconto já gravado (nunca do payload).
    const { data, error: erroLeitura } = await escopo.buscarPorId(
      "produtos",
      id,
      "desconto_tipo, desconto_valor",
    );
    if (erroLeitura) throw erroLeitura;
    const desconto = descontoGravado(data);
    if (desconto == null) return { ok: false, erro: MSG_SALVAR };

    const recusa = validarPrecoContraDesconto(
      parsed.data.preco,
      desconto.tipo,
      desconto.valor,
    );
    if (recusa != null) return { ok: false, erro: recusa };

    // Patch de DUAS chaves, montado campo a campo (nunca por spread). Escopo
    // cross-loja (loja_id + id) pelo wrapper; loja_id não vai no patch.
    const { error } = await escopo.atualizar("produtos", id, {
      nome: parsed.data.nome,
      preco: parsed.data.preco,
    });
    if (error) {
      console.error("[atualizarNomeEPrecoAdmin]", error);
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR) };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarNomeEPrecoAdmin]", e);
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR) };
  }
}

export async function atualizarProdutoAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // 🔴 PARIDADE com o lojista: no UPDATE `visibilidade` é OBRIGATÓRIA. Sob
  // `service_role` (BYPASSRLS) nenhuma RLS segura esta via — um payload sem o
  // campo, com o default do INSERT, reescreveria `'menu'` num produto
  // exclusivo de cardápio, e o admin teria mudado a declaração do lojista sem
  // pedir. Recusar no parse é o fail-closed: nenhum patch sai daqui.
  const parsed = schemaProdutoUpdate.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseProduto(parsed.error.issues) };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    if (parsed.data.categoria_id != null) {
      const pertence = await categoriaPertenceALoja(escopo, parsed.data.categoria_id);
      if (!pertence) return { ok: false, erro: "Categoria inválida." };
    }

    // RN-03: prazo em hora local → instante no fuso da LOJA-ALVO.
    const dados = await comPrazosDaLojaAlvo(svc, loja.lojaId, parsed.data);
    if (dados == null) return { ok: false, erro: "Loja não encontrada." };

    // Escopo cross-loja (loja_id + id) pelo wrapper; loja_id não vai no patch.
    const { error } = await escopo.atualizar("produtos", id, dados);
    if (error) {
      console.error("[atualizarProdutoAdmin]", error);
      // [261] Paridade com o caminho do lojista: a recusa de RN-14 vira frase
      // acionável (o trigger é SECURITY DEFINER e vale sob `service_role`), o
      // resto segue genérico.
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR) };
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
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR) };
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

export async function alternarOcultoAdmin(
  lojaId: string,
  id: string,
  oculto: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Toggle de VISIBILIDADE escopado por id E loja_id (cross-loja) pelo wrapper.
    // NÃO mexe em `disponivel` (RN-6-b), espelha alternarOculto do lojista.
    const { error } = await escopo.atualizar("produtos", id, { oculto });
    if (error) {
      console.error("[alternarOcultoAdmin]", error);
      return { ok: false, erro: "Não foi possível atualizar o produto." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.visibilidade",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[alternarOcultoAdmin]", e);
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

/**
 * [269] Gêmea admin de `definirVisibilidadeEmProdutos` (261): declara a
 * visibilidade de uma SELEÇÃO de produtos da LOJA-ALVO.
 *
 * Nasce aqui, e não em `admin-cardapios.ts`, porque a linha escrita é de
 * `produtos` — e é a MESMA action que serve as duas superfícies do mundo admin:
 * o `devolverAoMenu` de `AcoesCardapios` e o `definirVisibilidade` de
 * `AcoesLote`. Sem ela nenhuma das duas compila no hub admin.
 *
 * R5 (registrado): `visibilidade` é declaração do LOJISTA e o sistema nunca a
 * muda sozinho — aqui quem clica é outra pessoa. Fica rastreável em
 * `admin_acessos`; nada além da contagem entra em `metadados`.
 *
 * UPDATE escopado por `loja_id` da URL validado (sob `service_role` não há RLS)
 * + `in("id", …)`: id de outra loja simplesmente não casa linha.
 */
export async function definirVisibilidadeEmProdutosAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaVisibilidadeEmLote.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_SALVAR };
  const { produto_ids, visibilidade } = parsed.data;

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error } = await svc
      .from("produtos")
      .update({ visibilidade })
      .eq("loja_id", loja.lojaId)
      .in("id", produto_ids);
    if (error) {
      console.error("[definirVisibilidadeEmProdutosAdmin]", error);
      // [261] Paridade: a recusa de RN-14 vira frase acionável (o trigger é
      // SECURITY DEFINER e vale sob `service_role`), o resto segue genérico.
      return { ok: false, erro: erroDeEscritaDeProduto(error, MSG_SALVAR) };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "produto.visibilidade_lote",
      metadados: { produtos: produto_ids.length, visibilidade },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[definirVisibilidadeEmProdutosAdmin]", e);
    return { ok: false, erro: erroDeEscritaDeProduto(e, MSG_SALVAR) };
  }
}
