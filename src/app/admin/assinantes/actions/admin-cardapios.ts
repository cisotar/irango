"use server";

/**
 * Variantes ADMIN das nove Server Actions de cardápio (issue 269, fase 4 —
 * `crítica: SIM`). Escrevem na LOJA-ALVO (`lojaId` explícito, vindo da URL
 * admin) sob `service_role`, escopadas pelo wrapper `escopo` (injeta
 * `.eq("loja_id")` + `.eq("id")` por construção).
 *
 * Gêmeas de `src/lib/actions/cardapio.ts`, e a paridade É a proteção:
 * `service_role` tem BYPASSRLS, então `cardapios_escrita_propria` e
 * `cardapio_produtos_escrita_propria` NÃO alcançam este caminho. O que protege é
 *   1. `verificarAdminSaaS()` ANTES de elevar (fail-closed, D-4);
 *   2. `loja_id` SEMPRE do `lojaId` da URL validado, injetado por ÚLTIMO pelo
 *      wrapper — nunca do payload;
 *   3. as FKs compostas `(cardapio_id, loja_id)` / `(produto_id, loja_id)`
 *      (20260920129000), que valem sob qualquer role;
 *   4. o trigger `security definer` de RN-14 (20260920131000);
 *   5. a paridade de validação e de MENSAGEM com o caminho do lojista — o mesmo
 *      zod isomórfico (`lib/validacoes/cardapio.ts`) e o mesmo contrato neutro
 *      (`lib/actions/cardapio-contrato.ts`). Nenhuma frase é redeclarada aqui:
 *      cópia vira drift na primeira correção feita de um lado só.
 *
 * Recálculo no servidor (o análogo do mandato 1 nesta fatia é DATA, não
 * dinheiro): `prazo_fim` sob preset é derivado por `calcularFimDoPreset` e o
 * `fim` do cliente é DESCARTADO (RN-04); a travessia hora local → instante usa
 * `lojas.timezone` da LOJA-ALVO lido do banco (`buscarLojaAdminPorId`), nunca o
 * fuso do admin nem um fuso do payload; `ordem` é `max(ordem) + 1` lido da
 * loja-alvo (RN-15).
 *
 * D7: `registrarAcessoAdmin` cobre as OITO escritas. `preverLoteAdmin` é leitura
 * pura e não loga — mas passa por `prepararContextoAdmin`, que é a prova de
 * admin antes de elevar.
 *
 * REGRA do Next: arquivo `'use server'` só exporta função async — tipos e
 * constantes ficam locais ou vêm do módulo neutro.
 */

import {
  schemaCardapio,
  schemaIdCardapio,
  schemaLoteDeProdutos,
  schemaLoteDeCategoria,
  schemaPreviaDeLote,
} from "@/lib/validacoes/cardapio";
import {
  MSG_GENERICA_LOTE,
  MSG_SALVAR,
  MSG_REMOVER,
  MSG_CONVERTER,
  MSG_LOJA,
  MSG_INVALIDO,
  MSG_EXCLUSIVOS_SEM_NUMERO,
  mensagemExclusivos,
  ehErroDeExclusivoOrfao,
  erroDoLote,
  erroDeParseCardapio,
  linhaDoCardapio,
  resumirPrevia,
  type Previa,
  type Resultado,
  type ResultadoCardapio,
  type ResultadoRemocao,
} from "@/lib/actions/cardapio-contrato";
import {
  buscarProdutosQueFicariamOrfaos,
  buscarLinhasDaPrevia,
  cardapioPertenceALoja,
} from "@/lib/supabase/queries/cardapios";
import { buscarLojaAdminPorId } from "@/lib/supabase/queries/lojas";
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";

/** A mesma recusa de `lojaId` fora de forma de todas as actions admin. */
const MSG_LOJA_INVALIDA = "Loja inválida.";

// ════════════════════════════════════════ CRUD da entidade cardápio (269/255)

/**
 * Cria o cardápio na LOJA-ALVO. `ordem = max(ordem) + 1` lido da loja-alvo
 * (RN-15) — o cliente não envia `ordem` e o schema nem aceita o campo.
 */
export async function criarCardapioAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoCardapio> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  const parsed = schemaCardapio.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseCardapio(parsed.error.issues) };
  }

  // Fail-closed: a prova de admin fica FORA do try → a exceção PROPAGA e o
  // service client só nasce depois dela.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // RN-04: o fuso é o da LOJA-ALVO, lido do banco.
    const lojaAlvo = await buscarLojaAdminPorId(svc, loja.lojaId);
    if (lojaAlvo == null) return { ok: false, erro: MSG_LOJA };

    const { data: ultimo, error: erroOrdem } = await svc
      .from("cardapios")
      .select("ordem")
      .eq("loja_id", loja.lojaId)
      .order("ordem", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroOrdem) {
      console.error("[criarCardapioAdmin]", erroOrdem);
      return { ok: false, erro: MSG_SALVAR };
    }

    // `loja_id` é injetado POR ÚLTIMO pelo wrapper — payload hostil não o move.
    const { error } = await escopo.inserir("cardapios", {
      ...linhaDoCardapio(parsed.data, lojaAlvo.timezone),
      ordem: (ultimo?.ordem ?? -1) + 1,
    });
    if (error) {
      // Inclui o 23514 dos CHECKs de vigência: texto cru no log, genérica na
      // tela (`seguranca.md` §14).
      console.error("[criarCardapioAdmin]", error);
      return { ok: false, erro: MSG_SALVAR };
    }

    registrarAcessoAdmin(svc, { lojaId: loja.lojaId, acao: "cardapio.criar" });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarCardapioAdmin]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/**
 * Renomeia e/ou reconfigura a vigência. Escreve a linha INTEIRA de vigência (o
 * schema devolve NULL explícito nos campos do modo oposto), e NUNCA `ativo` —
 * quem mexe nele é `ligarDesligarCardapioAdmin`, e só ele.
 */
export async function atualizarCardapioAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<ResultadoCardapio> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO };
  }

  const parsed = schemaCardapio.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseCardapio(parsed.error.issues) };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const lojaAlvo = await buscarLojaAdminPorId(svc, loja.lojaId);
    if (lojaAlvo == null) return { ok: false, erro: MSG_LOJA };

    // Escopo duplo (`loja_id` + `id`) por construção: um `id` de outra loja não
    // casa com nenhuma linha e não escreve nada.
    const { error } = await escopo.atualizar(
      "cardapios",
      id,
      linhaDoCardapio(parsed.data, lojaAlvo.timezone),
    );
    if (error) {
      console.error("[atualizarCardapioAdmin]", error);
      return { ok: false, erro: MSG_SALVAR };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCardapioAdmin]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/** RN-03 — mexe SÓ em `ativo`; a configuração de vigência continua gravada. */
export async function ligarDesligarCardapioAdmin(
  lojaId: string,
  id: string,
  ativo: boolean,
): Promise<ResultadoCardapio> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };
  if (typeof ativo !== "boolean") return { ok: false, erro: MSG_SALVAR };
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error } = await escopo.atualizar("cardapios", id, { ativo });
    if (error) {
      console.error("[ligarDesligarCardapioAdmin]", error);
      return { ok: false, erro: MSG_SALVAR };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.ativo",
      entidadeId: id,
      metadados: { ativo },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[ligarDesligarCardapioAdmin]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/**
 * Remove o cardápio da loja-alvo. RECUSADA enquanto existir produto exclusivo
 * que ficaria sem nenhum cardápio (RN-14): a mesma leitura, a mesma frase e o
 * mesmo número do caminho do lojista — e a saída (converter) é um clique, dado
 * por quem opera, porque `visibilidade` é declaração do LOJISTA.
 */
export async function removerCardapioAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoRemocao> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA, exclusivos: 0 };
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO, exclusivos: 0 };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const orfaos = await buscarProdutosQueFicariamOrfaos(svc, loja.lojaId, id);
    if (orfaos.length > 0) {
      return {
        ok: false,
        erro: mensagemExclusivos(orfaos.length),
        exclusivos: orfaos.length,
      };
    }

    const { error } = await escopo.remover("cardapios", id);
    if (error) {
      console.error("[removerCardapioAdmin]", error);
      // Backstop: o trigger deferido só falha no COMMIT, depois da leitura.
      if (ehErroDeExclusivoOrfao(error)) {
        return { ok: false, erro: MSG_EXCLUSIVOS_SEM_NUMERO, exclusivos: 0 };
      }
      return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.remover",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerCardapioAdmin]", e);
    if (ehErroDeExclusivoOrfao(e)) {
      return { ok: false, erro: MSG_EXCLUSIVOS_SEM_NUMERO, exclusivos: 0 };
    }
    return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
  }
}

/**
 * A saída oferecida pelo diálogo de remoção: os exclusivos que ficariam ÓRFÃOS
 * voltam ao menu. Converte EXATAMENTE o conjunto que a recusa anunciou — nem os
 * exclusivos pendurados em outro cardápio, que não correm risco nenhum.
 *
 * R5 (registrado, não mitigado por gate): no hub admin este clique é de OUTRA
 * pessoa. Fica rastreável em `admin_acessos`.
 */
export async function converterExclusivosParaMenuAdmin(
  lojaId: string,
  cardapioId: string,
): Promise<ResultadoCardapio> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };
  if (!schemaIdCardapio.safeParse(cardapioId).success) {
    return { ok: false, erro: MSG_INVALIDO };
  }

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const orfaos = await buscarProdutosQueFicariamOrfaos(
      svc,
      loja.lojaId,
      cardapioId,
    );
    // Nenhum órfão ⇒ nada a escrever, mas o ACESSO é registrado assim mesmo:
    // o log de `admin_acessos` é de operação admin sobre a loja-alvo, não de
    // linha alterada — e uma conversão que não achou ninguém é exatamente o
    // rastro que explica por que a tela não mudou.
    if (orfaos.length > 0) {
      const { error } = await svc
        .from("produtos")
        .update({ visibilidade: "menu" })
        .eq("loja_id", loja.lojaId)
        .eq("visibilidade", "cardapio")
        .in("id", orfaos);
      if (error) {
        console.error("[converterExclusivosParaMenuAdmin]", error);
        return { ok: false, erro: MSG_CONVERTER };
      }
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.converter",
      entidadeId: cardapioId,
      metadados: { produtos: orfaos.length },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[converterExclusivosParaMenuAdmin]", e);
    return { ok: false, erro: MSG_CONVERTER };
  }
}

// ═══════════════════════════════════════════════ Lote (269/251) ═════════════

/**
 * Vincula uma SELEÇÃO EXPLÍCITA de produtos ao cardápio (RN-09), em UMA
 * instrução: PRODUTO alheio ou inexistente derruba o lote inteiro pelas FKs
 * compostas, e NENHUMA linha é gravada — nem as legítimas. Gravar as boas e
 * reclamar do resto denunciaria, pela diferença, quais ids existem em outra
 * loja.
 *
 * O `cardapio_id` NÃO é coberto por essa FK em todo caso (270): o
 * `ON CONFLICT (cardapio_id, produto_id) DO NOTHING` descarta a linha cujo par
 * já existe na loja dona do cardápio ANTES de a FK `(cardapio_id, loja_id)` ser
 * avaliada — aqui, onde `service_role` tem BYPASSRLS, isso devolveria
 * `{ ok: true }` e gravaria `admin_acessos` apontando para entidade de OUTRO
 * tenant. A posse é provada antes da escrita E antes do log.
 *
 * `escopo.inserirVarios` injeta `loja_id` por último em CADA linha (D5).
 * RN-10: a idempotência vem do `on conflict do nothing`.
 */
export async function aplicarCardapioEmProdutosAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, produto_ids } = parsed.data;

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // 270: posse do cardápio na LOJA-ALVO antes de qualquer escrita — inclusive
    // antes de `registrarAcessoAdmin`. Alheio e inexistente: a mesma frase.
    if (!(await cardapioPertenceALoja(svc, loja.lojaId, cardapio_id))) {
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    const { error } = await escopo.inserirVarios(
      "cardapio_produtos",
      produto_ids.map((produto_id) => ({ cardapio_id, produto_id })),
      { onConflict: "cardapio_id,produto_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("[aplicarCardapioEmProdutosAdmin]", error);
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.aplicar_produtos",
      entidadeId: cardapio_id,
      metadados: { produtos: produto_ids.length },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmProdutosAdmin]", e);
    return { ok: false, erro: MSG_GENERICA_LOTE };
  }
}

/**
 * Vincula TODOS os produtos de uma categoria (RN-10), pela RPC da issue 250 —
 * convertida a `security definer` pela migration 20260921120000, que é o que
 * permite a via de serviço. A lista NUNCA é lida em JS para ser reenviada: a
 * expansão acontece dentro da transação (`insert … select`).
 *
 * `p_loja_id` é o `lojaId` da URL VALIDADO (camada 4 do enforcement exige esta
 * origem estaticamente): sob `service_role` a trava T2 é dispensada de
 * propósito, então este argumento é o único escopo de tenant que resta antes de
 * T3. Os fragmentos de T2/T3 são de log e de teste, nunca de tela.
 */
export async function aplicarCardapioEmCategoriaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  const parsed = schemaLoteDeCategoria.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, categoria_id } = parsed.data;

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error } = await svc.rpc("aplicar_cardapio_em_categoria", {
      p_loja_id: loja.lojaId,
      p_cardapio_id: cardapio_id,
      p_categoria_id: categoria_id,
    });
    if (error) {
      console.error("[aplicarCardapioEmCategoriaAdmin]", error);
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.aplicar_categoria",
      entidadeId: cardapio_id,
      metadados: { categoria_id },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmCategoriaAdmin]", e);
    return { ok: false, erro: MSG_GENERICA_LOTE };
  }
}

/**
 * Desfaz o vínculo. DELETE escopado por `loja_id` da URL + `cardapio_id` +
 * a lista de produtos: um `cardapio_id` de outra loja no payload não desvia o
 * escopo, só não casa linha nenhuma. Mesmo zod da gravação.
 *
 * 270: "não casa linha nenhuma" era justamente o problema — apagar zero e
 * devolver `{ ok: true }` grava `cardapio.tirar_produtos` com `entidade_id` de
 * outro tenant. A posse vem antes do DELETE e antes do log.
 */
export async function tirarDeCardapioAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, produto_ids } = parsed.data;

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // 270: a mesma prova de posse da gravação, com a mesma frase.
    if (!(await cardapioPertenceALoja(svc, loja.lojaId, cardapio_id))) {
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    const { error } = await svc
      .from("cardapio_produtos")
      .delete()
      .eq("loja_id", loja.lojaId)
      .eq("cardapio_id", cardapio_id)
      .in("produto_id", produto_ids);
    if (error) {
      console.error("[tirarDeCardapioAdmin]", error);
      return { ok: false, erro: erroDoLote(error) };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.tirar_produtos",
      entidadeId: cardapio_id,
      metadados: { produtos: produto_ids.length },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[tirarDeCardapioAdmin]", e);
    return { ok: false, erro: erroDoLote(e) };
  }
}

/**
 * Prévia do servidor para o diálogo de confirmação (RN-09-a). NÃO grava e NÃO
 * loga (D7) — mas passa por `prepararContextoAdmin`, a prova de admin.
 *
 * A leitura é `where loja_id = <loja-alvo> and …`: um id de outra loja
 * simplesmente não volta, e a resposta é byte a byte a de um id inexistente
 * (`seguranca.md` §14). As contagens saem de `resumirPrevia`, a MESMA do
 * lojista — divergir aqui seria mentir para quem está prestes a confirmar uma
 * escrita em lote na loja de outra pessoa.
 */
export async function preverLoteAdmin(
  lojaId: string,
  entrada: unknown,
): Promise<Previa> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  const parsed = schemaPreviaDeLote.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const linhas = await buscarLinhasDaPrevia(svc, loja.lojaId, parsed.data);
    return { ok: true, ...resumirPrevia(linhas) };
  } catch (e) {
    console.error("[preverLoteAdmin]", e);
    return { ok: false, erro: MSG_GENERICA_LOTE };
  }
}
