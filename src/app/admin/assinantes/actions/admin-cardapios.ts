"use server";

/**
 * Variantes ADMIN das dez Server Actions de cardápio (issue 269, fase 4 —
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
 * D7: `registrarAcessoAdmin` cobre as NOVE escritas. `preverLoteAdmin` é leitura
 * pura e não loga — mas passa por `prepararContextoAdmin`, que é a prova de
 * admin antes de elevar.
 *
 * REGRA do Next: arquivo `'use server'` só exporta função async — tipos e
 * constantes ficam locais ou vêm do módulo neutro.
 */

import {
  schemaCardapio,
  schemaIdCardapio,
  schemaModoRemocao,
  schemaLoteDeProdutos,
  schemaLoteDeProdutosComDias,
  schemaLoteDeCategoria,
  schemaPreviaDeLote,
  schemaDiasDoVinculo,
  normalizarDiasDoVinculo,
} from "@/lib/validacoes/cardapio";
import {
  MSG_GENERICA_LOTE,
  MSG_SALVAR,
  MSG_REMOVER,
  MSG_CONVERTER,
  MSG_LOJA,
  MSG_INVALIDO,
  MSG_DIAS_DO_VINCULO,
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
  type ModoRemocaoExclusivos,
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
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";
import { revalidatePath } from "next/cache";

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
    const { error, count } = await escopo.atualizar(
      "cardapios",
      id,
      linhaDoCardapio(parsed.data, lojaAlvo.timezone),
    );
    if (error) {
      console.error("[atualizarCardapioAdmin]", error);
      return { ok: false, erro: MSG_SALVAR };
    }
    // [274 · D8] Zero linhas casadas = cardápio inexistente OU de outra loja.
    // A recusa vem ANTES do log: `entidade_id` de outro tenant não pode virar
    // linha em `admin_acessos`. `count` ausente NÃO recusa (R4).
    if (count === 0) return { ok: false, erro: MSG_SALVAR };

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
    const { error, count } = await escopo.atualizar("cardapios", id, { ativo });
    if (error) {
      console.error("[ligarDesligarCardapioAdmin]", error);
      return { ok: false, erro: MSG_SALVAR };
    }
    // [274 · D8] Mesma regra: recusa antes do log.
    if (count === 0) return { ok: false, erro: MSG_SALVAR };

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
 *
 * [284] `modo` dá as outras duas saídas — `arquivar` (reversível) e `cascata`
 * (apaga os órfãos) —, em paridade byte a byte com o lojista. Aqui o clique é
 * de OUTRA pessoa: os dois modos novos gravam `admin_acessos` com o modo e a
 * contagem recalculada (RN-13).
 */
export async function removerCardapioAdmin(
  lojaId: string,
  id: string,
  modo: ModoRemocaoExclusivos = "manter",
): Promise<ResultadoRemocao> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA, exclusivos: 0 };
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO, exclusivos: 0 };
  }
  // [284 · RN-01] Parse do modo ANTES de elevar: um valor desconhecido nunca
  // cai num ramo destrutivo, e nenhum I/O acontece.
  const modoParsed = schemaModoRemocao.safeParse(modo);
  if (!modoParsed.success) {
    return { ok: false, erro: MSG_INVALIDO, exclusivos: 0 };
  }
  const escolha = modoParsed.data;

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Quantos produtos o gesto atingiu — vai para o log de auditoria (RN-13).
    let atingidos = 0;

    if (escolha === "manter") {
      const orfaos = await buscarProdutosQueFicariamOrfaos(svc, loja.lojaId, id);
      if (orfaos.length > 0) {
        return {
          ok: false,
          erro: mensagemExclusivos(orfaos.length),
          exclusivos: orfaos.length,
        };
      }
    } else {
      // [284 · RN-04] Sob `service_role` (BYPASSRLS) a posse é a ÚNICA barreira
      // antes da leitura: sem ela, um `id` alheio faria o recálculo rodar sobre
      // outro tenant e o log gravaria `entidade_id` que não é da loja-alvo.
      // Alheio e inexistente: a MESMA frase (§14).
      if (!(await cardapioPertenceALoja(svc, loja.lojaId, id))) {
        return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
      }

      // RN-02: a lista é recalculada aqui, nunca aceita do cliente.
      const orfaos = await buscarProdutosQueFicariamOrfaos(svc, loja.lojaId, id);
      atingidos = orfaos.length;

      if (orfaos.length > 0) {
        // RN-06: produtos PRIMEIRO, cardápio DEPOIS. Escopo explícito por
        // `loja_id` da URL validada + 2º cinto de `visibilidade = 'cardapio'`:
        // é ele que substitui a RLS nesta via.
        const alvo = svc.from("produtos");
        const escrita =
          escolha === "arquivar"
            ? // RN-05: exatamente dois campos. `disponivel` é "esgotado", que
              // CONTINUA visível, e não entra aqui.
              alvo.update({ oculto: true, visibilidade: "menu" })
            : alvo.delete();
        const { error: erroProdutos } = await escrita
          .eq("loja_id", loja.lojaId)
          .eq("visibilidade", "cardapio")
          .in("id", orfaos);
        if (erroProdutos) {
          console.error("[removerCardapioAdmin]", erroProdutos);
          // Sem seguir para o request 2, e sem log: o cardápio sobrevive e o
          // estado é reconciliável numa segunda tentativa.
          return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
        }
        // O gesto destrutivo em `produtos` JÁ commitou aqui — o rastro não
        // pode depender do desfecho do request 2 (achado da auditoria da
        // issue 284/285). Se o DELETE do cardápio falhar por corrida (RN-09)
        // ou já tiver sido removido em paralelo, o hub ainda sabe quem
        // arquivou/apagou os N produtos.
        registrarAcessoAdmin(svc, {
          lojaId: loja.lojaId,
          acao: "cardapio.remover",
          entidadeId: id,
          metadados: { modo: escolha, produtos: atingidos, etapa: "produtos" },
        });
      }
    }

    const { error, count } = await escopo.remover("cardapios", id);
    if (error) {
      console.error("[removerCardapioAdmin]", error);
      // Backstop: o trigger deferido só falha no COMMIT, depois da leitura.
      if (ehErroDeExclusivoOrfao(error)) {
        return { ok: false, erro: MSG_EXCLUSIVOS_SEM_NUMERO, exclusivos: 0 };
      }
      return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
    }
    // [274 · D8] Zero linhas apagadas: recusa antes do log.
    if (count === 0) return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.remover",
      entidadeId: id,
      // RN-13: o rastro do gesto de OUTRA pessoa. `manter` continua com o log
      // de hoje, sem metadados — nada mudou no que ele faz. Nos modos novos
      // esta é a SEGUNDA entrada (a 1ª, `etapa:"produtos"`, já saiu acima) —
      // ela confirma que o cardápio também saiu, não só os produtos.
      ...(escolha === "manter"
        ? {}
        : { metadados: { modo: escolha, produtos: atingidos, etapa: "cardapio" } }),
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
    // [274 · D8] A posse do cardápio na LOJA-ALVO ANTES de ler os órfãos:
    // `service_role` tem BYPASSRLS, então um `cardapioId` alheio leria vínculos
    // de OUTRO tenant e o log gravaria `entidade_id` que não é desta loja.
    // Alheio e inexistente: a mesma frase.
    if (!(await cardapioPertenceALoja(svc, loja.lojaId, cardapioId))) {
      return { ok: false, erro: MSG_CONVERTER };
    }

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

  const parsed = schemaLoteDeProdutosComDias.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, produto_ids } = parsed.data;
  // [287] Mesma normalização do lojista — a paridade é a proteção desta via.
  const dias = normalizarDiasDoVinculo(parsed.data.dias_semana);

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // 270: posse do cardápio na LOJA-ALVO antes de qualquer escrita — inclusive
    // antes de `registrarAcessoAdmin`. Alheio e inexistente: a mesma frase.
    if (!(await cardapioPertenceALoja(svc, loja.lojaId, cardapio_id))) {
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    const { error } = await escopo.inserirVarios(
      "cardapio_produtos",
      produto_ids.map((produto_id) => ({
        cardapio_id,
        produto_id,
        dias_semana: dias,
      })),
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

// ═══════════════ [274] A agenda do VÍNCULO — RN-10, RN-11, RN-12, RN-14 ═════

/**
 * Gêmea admin de `definirDiasDoVinculo`: define em QUE DIAS DA SEMANA um item
 * aparece dentro de um cardápio da LOJA-ALVO.
 *
 * Aqui a RLS não vale (`service_role` tem BYPASSRLS). O que protege:
 *  1. `validarLojaIdAdmin` + `prepararContextoAdmin` — prova de admin ANTES de
 *     elevar, e a exceção PROPAGA (fail-closed, D-4);
 *  2. `escopo.atualizarPorChave`, que injeta `.eq("loja_id", <lojaId da URL>)`
 *     por construção e escopa a linha pela chave natural `(cardapio_id,
 *     produto_id)` — `loja_id` NUNCA vem do payload, e o `.strict()` do zod o
 *     recusa antes de qualquer I/O (RN-10);
 *  3. as FKs compostas `(cardapio_id, loja_id)` / `(produto_id, loja_id)`, que
 *     valem sob qualquer role: a linha da loja A só referencia cardápio e
 *     produto da loja A;
 *  4. `count === 0` ⇒ recusa, ANTES do log e de qualquer `revalidatePath` — um
 *     id-probe de outro tenant não vira linha em `admin_acessos` nem oráculo
 *     de existência (a frase de alheio é a de inexistente, byte a byte).
 *
 * O log grava a CONTAGEM de dias já normalizada (`dias: n`), nunca o conteúdo.
 */
export async function definirDiasDoVinculoAdmin(
  lojaId: string,
  payload: unknown,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  const parsed = schemaDiasDoVinculo.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_DIAS_DO_VINCULO };
  const { cardapio_id, produto_id, dias_semana } = parsed.data;

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const dias = normalizarDiasDoVinculo(dias_semana);

    const { error, count } = await escopo.atualizarPorChave(
      "cardapio_produtos",
      { cardapio_id, produto_id },
      { dias_semana: dias },
    );
    if (error) {
      console.error("[definirDiasDoVinculoAdmin]", error);
      return { ok: false, erro: MSG_DIAS_DO_VINCULO };
    }
    // Sem `console.error`: o servidor não aprendeu nada que valha registro.
    // `count` ausente NÃO recusa (R4).
    if (count === 0) return { ok: false, erro: MSG_DIAS_DO_VINCULO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cardapio.definir_dias",
      entidadeId: cardapio_id,
      metadados: { produto_id, dias: dias?.length ?? 0 },
    });
    revalidarLojaAdmin(loja.lojaId);
    // [274 · D9] O DETALHE concreto do cardápio na loja-alvo — `revalidarLojaAdmin`
    // cobre a lista, o hub e a vitrine, mas não a tela desta feature.
    revalidatePath(`${rotaCardapiosAdmin(loja.lojaId)}/${cardapio_id}`);
    return { ok: true };
  } catch (e) {
    console.error("[definirDiasDoVinculoAdmin]", e);
    return { ok: false, erro: MSG_DIAS_DO_VINCULO };
  }
}
