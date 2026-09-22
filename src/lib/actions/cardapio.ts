"use server";

/**
 * Server Actions de LOTE do cardápio sazonal (issue 251) — a metade de Server
 * Action da fatia crítica 5. Spec: specs/cardapio-sazonal.md · D2, D14 ·
 * RN-09, RN-09-a, RN-10, RN-11.
 *
 * O payload aqui é uma LISTA DE IDS escolhida pelo cliente: o vetor clássico de
 * IDOR. O contrato, espelhando `reordenarCategorias` (produto.ts:346):
 *
 *  - parse zod ANTES de qualquer I/O (nem `buscarLojaDoDono` é chamado se o
 *    payload não tem forma);
 *  - `loja_id` SEMPRE de `buscarLojaDoDono` (auth.uid()), NUNCA do payload;
 *  - client AUTENTICADO — `createServiceClient` (BYPASSRLS) não entra aqui;
 *  - **nenhum pre-check da LISTA DE PRODUTOS em JS**: um `select` dos ids antes
 *    do `insert` gravaria os válidos do lote e denunciaria, pela diferença
 *    entre pedido e resultado, QUAIS ids existem em outra loja. A posse deles é
 *    provada DENTRO da transação: as FKs compostas de 20260920129000
 *    (`cardapio_produtos_produto_fk`, `cardapio_produtos_cardapio_fk`) derrubam
 *    a instrução inteira — tudo ou nada — QUANDO a linha chega ao índice;
 *  - **a posse do `cardapio_id`, porém, é provada ANTES** (270), por
 *    `cardapioPertenceALoja`: com `ON CONFLICT DO NOTHING` a linha cujo par já
 *    existe é descartada antes de a FK `(cardapio_id, loja_id)` ser avaliada, e
 *    o lote alheio terminaria sem erro. Um id, a PRÓPRIA loja, `false` idêntico
 *    para alheio e inexistente — não é o pre-check acima e não é oráculo;
 *  - UMA mensagem genérica para id alheio, id inexistente, cardápio alheio e
 *    falha de banco. `23503`, nome de constraint e fragmento da RPC vão para o
 *    log do servidor, nunca para a tela (`seguranca.md` §14).
 */

import {
  schemaLoteDeProdutos,
  schemaLoteDeProdutosComDias,
  schemaLoteDeCategoria,
  schemaPreviaDeLote,
  schemaCardapio,
  schemaIdCardapio,
  schemaModoRemocao,
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
  type Resultado,
  type Previa,
  type ResultadoCardapio,
  type ResultadoRemocao,
  type ModoRemocaoExclusivos,
} from "@/lib/actions/cardapio-contrato";
import {
  buscarProdutosQueFicariamOrfaos,
  buscarLinhasDaPrevia,
  cardapioPertenceALoja,
} from "@/lib/supabase/queries/cardapios";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";
import { ROTA_CARDAPIOS_LOJISTA } from "@/lib/utils/rotasCardapios";

// [269 · D2/D3] As frases, os reconhecedores de erro do trigger, a
// normalização de prazo pelo fuso e o resumo da prévia moram em
// `cardapio-contrato.ts`; as duas leituras compartilhadas, em
// `queries/cardapios.ts`. Este arquivo é UM dos dois callers — o outro é
// `src/app/admin/assinantes/actions/admin-cardapios.ts`, que escreve com
// `service_role` e por isso não tem a RLS como rede. Redeclarar qualquer coisa
// daquelas aqui reabre o drift que a extração fechou.

/**
 * RN-11: os três caminhos REAIS, e a vitrine pelo slug da PRÓPRIA loja. Nunca a
 * forma coringa `("/loja/[slug]", "page")`, que invalidaria o Router Cache da
 * vitrine de TODAS as lojas. `CAMINHO_PAINEL` de produto.ts:35
 * (`/painel/cardapio`, singular) não existe como rota — débito conhecido
 * (`architecture.md` §10), não reusado aqui de propósito.
 */
function revalidarCaminhosDoCardapio(slug: string, cardapioId?: string): void {
  revalidatePath(ROTA_CARDAPIOS_LOJISTA);
  revalidatePath("/painel/produtos");
  revalidatePath(`/loja/${slug}`);
  // [274 · D9] `revalidatePath("/painel/cardapios")` invalida SÓ aquele path
  // (type `page` é o default) — não o DETALHE `/painel/cardapios/[cardapioId]`,
  // que é a tela da agenda por item. O caminho CONCRETO, nunca a forma coringa
  // nem `"layout"`: revalidar o layout derrubaria o detalhe de todos os
  // cardápios da loja sem necessidade.
  if (cardapioId != null) {
    revalidatePath(`${ROTA_CARDAPIOS_LOJISTA}/${cardapioId}`);
  }
}

/**
 * Vincula uma SELEÇÃO EXPLÍCITA de produtos a um cardápio (RN-09).
 *
 * Uma única instrução com todos os PRODUTOS: se qualquer um deles for de outra
 * loja ou inexistente, a FK composta derruba o lote inteiro e NENHUMA linha é
 * gravada — nem para os ids legítimos, nem na loja alheia. Um upsert por id
 * gravaria os bons e confirmaria, pela diferença, qual é o alheio.
 *
 * O `cardapio_id`, esse, é provado ANTES (270): a FK `(cardapio_id, loja_id)`
 * só é avaliada quando a linha chega ao índice, e `ON CONFLICT DO NOTHING`
 * descarta antes disso a linha cujo par já existe na loja DONA do cardápio —
 * o lote alheio terminaria sem erro e devolveria `{ ok: true }` por uma escrita
 * que não aconteceu.
 *
 * RN-10: idempotência vem do `on conflict do nothing` (`ignoreDuplicates`),
 * não de um SELECT prévio de "quem já está".
 */
export async function aplicarCardapioEmProdutos(
  payload: unknown,
): Promise<Resultado> {
  const parsed = schemaLoteDeProdutosComDias.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, produto_ids } = parsed.data;
  // [287] A REPRESENTAÇÃO é decidida aqui, no servidor: dedup, ordem crescente
  // e `[]`/ausente/`null` → NULL ("todos os dias do cardápio", RN-11). O
  // cliente manda a intenção; nunca a representação.
  const dias = normalizarDiasDoVinculo(parsed.data.dias_semana);

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA_LOTE };

    // 270: posse do cardápio ANTES da escrita. Alheio e inexistente saem pela
    // MESMA frase — a leitura não vira oráculo.
    if (!(await cardapioPertenceALoja(supabase, loja.id, cardapio_id))) {
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    const linhas = produto_ids.map((produto_id) => ({
      loja_id: loja.id,
      cardapio_id,
      produto_id,
      dias_semana: dias,
    }));

    const { error } = await supabase
      .from("cardapio_produtos")
      .upsert(linhas, {
        onConflict: "cardapio_id,produto_id",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error("[aplicarCardapioEmProdutos]", error);
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmProdutos]", e);
    return { ok: false, erro: MSG_GENERICA_LOTE };
  }
}

/**
 * Vincula TODOS os produtos de uma categoria (RN-10), via a RPC da issue 250.
 *
 * A lista de produtos NUNCA é lida em JS para ser reenviada: a expansão
 * acontece dentro da transação (`insert ... select`), então produto criado ou
 * movido entre a leitura e a escrita não abre janela. Os fragmentos
 * `loja alheia` / `cardapio fora da loja` / `categoria fora da loja` das travas
 * T2/T3 são de log e de teste — aqui viram a mesma mensagem genérica.
 */
export async function aplicarCardapioEmCategoria(
  payload: unknown,
): Promise<Resultado> {
  const parsed = schemaLoteDeCategoria.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, categoria_id } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA_LOTE };

    const { error } = await supabase.rpc("aplicar_cardapio_em_categoria", {
      p_loja_id: loja.id,
      p_cardapio_id: cardapio_id,
      p_categoria_id: categoria_id,
    });
    if (error) {
      console.error("[aplicarCardapioEmCategoria]", error);
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmCategoria]", e);
    return { ok: false, erro: MSG_GENERICA_LOTE };
  }
}

/**
 * Desfaz o vínculo (D2). O DELETE é escopado pela loja DERIVADA além da RLS:
 * o mesmo escopo explícito que `categoriaPertenceALoja` aplica no CRUD. Usa o
 * MESMO zod da gravação — teto, unicidade e forma não têm versão frouxa aqui.
 *
 * 270: o escopo impede que a escrita SAIA da loja, mas com cardápio alheio ele
 * apenas não casa linha nenhuma — o DELETE apaga zero e devolve `{ ok: true }`.
 * A posse é provada antes, com a mesma frase de id inexistente.
 */
export async function tirarDeCardapio(payload: unknown): Promise<Resultado> {
  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };
  const { cardapio_id, produto_ids } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA_LOTE };

    // 270: mesma prova de posse do caminho de gravação, mesma frase.
    if (!(await cardapioPertenceALoja(supabase, loja.id, cardapio_id))) {
      return { ok: false, erro: MSG_GENERICA_LOTE };
    }

    const { error } = await supabase
      .from("cardapio_produtos")
      .delete()
      .eq("loja_id", loja.id)
      .eq("cardapio_id", cardapio_id)
      .in("produto_id", produto_ids);
    if (error) {
      console.error("[tirarDeCardapio]", error);
      return { ok: false, erro: erroDoLote(error) };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[tirarDeCardapio]", e);
    return { ok: false, erro: erroDoLote(e) };
  }
}

/**
 * Prévia do servidor para o diálogo de confirmação (RN-09-a). NÃO grava nada.
 *
 * A leitura é `where loja_id = <própria> and ...`: um id de outra loja
 * simplesmente NÃO volta. Nenhuma contagem de "ignorados", nenhum aviso — a
 * resposta de `[p1, pB]` é byte a byte a de `[p1]`, senão a prévia viraria
 * oráculo de existência (`seguranca.md` §14).
 *
 * D14: os dois números que o diálogo precisa (`menu` e `cardapio`) saem da
 * MESMA leitura — o cliente não conta nada e o servidor não lê duas vezes.
 */
export async function preverLoteAction(entrada: unknown): Promise<Previa> {
  const parsed = schemaPreviaDeLote.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA_LOTE };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA_LOTE };

    const linhas = await buscarLinhasDaPrevia(supabase, loja.id, parsed.data);
    return { ok: true, ...resumirPrevia(linhas) };
  } catch (e) {
    console.error("[preverLoteAction]", e);
    return { ok: false, erro: MSG_GENERICA_LOTE };
  }
}

// ═════════════════════════════════════ CRUD do cardápio (issue 255) ═════════
//
// As quatro operações do lojista sobre a ENTIDADE cardápio — criar, renomear/
// reconfigurar, ligar/desligar e remover — mais a saída que a remoção oferece.
// Spec: specs/cardapio-sazonal.md · D3, D3-a, D3-b, D14, D16 · RN-01, RN-02,
// RN-04, RN-11, RN-14, RN-15.
//
// Mesmo contrato de fronteira das actions de lote acima: parse zod ANTES de
// qualquer I/O, `loja_id` de `buscarLojaDoDono` (nunca do payload), client
// AUTENTICADO (`createServiceClient` não entra aqui), `revalidatePath` só no
// sucesso, e `23514`/`23000` crus no log — nunca na tela.
//
// A DATA também é recalculada no servidor. Com preset `diario`/`semanal`/
// `mensal`, `prazo_fim` sai de `calcularFimDoPreset(prazo_inicio, preset)` e o
// `fim` que veio do cliente é DESCARTADO (RN-04) — mesma classe do mandato 1
// aplicada a data em vez de dinheiro. E a travessia hora local → instante usa
// `lojas.timezone` LIDO DO BANCO (`buscarLojaDoDono`), nunca um fuso enviado
// pelo cliente.

/**
 * Cria o cardápio. `ordem = max(ordem) + 1` da loja (RN-15): cardápio novo
 * entra no FIM da faixa de seções de destaque. O máximo é lido do banco sob a
 * RLS do dono — o cliente não envia `ordem`, e o schema nem aceita o campo.
 */
export async function criarCardapio(
  payload: unknown,
): Promise<ResultadoCardapio> {
  const parsed = schemaCardapio.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseCardapio(parsed.error.issues) };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA };

    const { data: ultimo, error: erroOrdem } = await supabase
      .from("cardapios")
      .select("ordem")
      .eq("loja_id", loja.id)
      .order("ordem", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroOrdem) {
      console.error("[criarCardapio]", erroOrdem);
      return { ok: false, erro: MSG_SALVAR };
    }

    const { error } = await supabase.from("cardapios").insert({
      ...linhaDoCardapio(parsed.data, loja.timezone),
      loja_id: loja.id,
      ordem: (ultimo?.ordem ?? -1) + 1,
    });
    if (error) {
      // Inclui o 23514 dos CHECKs de vigência (20260920128000): o texto cru do
      // Postgres fica no log, o lojista recebe a genérica (`seguranca.md` §14).
      console.error("[criarCardapio]", error);
      return { ok: false, erro: MSG_SALVAR };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[criarCardapio]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/**
 * Renomeia e/ou reconfigura a vigência. O UPDATE escreve a linha INTEIRA de
 * vigência (o schema devolve NULL explícito nos campos do modo oposto), então
 * trocar de modo apaga a configuração do modo anterior em vez de deixá-la
 * pendurada e ser recusado pelo CHECK de disjunção.
 *
 * `ativo` NÃO entra aqui: quem mexe nele é `ligarDesligarCardapio`, e só ele.
 */
export async function atualizarCardapio(
  id: string,
  payload: unknown,
): Promise<ResultadoCardapio> {
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO };
  }

  const parsed = schemaCardapio.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: erroDeParseCardapio(parsed.error.issues) };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA };

    // Escopo explícito por `loja_id` ALÉM da RLS: um `id` de outra loja no
    // payload não casa com nenhuma linha e não escreve nada.
    const { error, count } = await supabase
      .from("cardapios")
      .update(linhaDoCardapio(parsed.data, loja.timezone), { count: "exact" })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[atualizarCardapio]", error);
      return { ok: false, erro: MSG_SALVAR };
    }
    // [274 · D8] Zero linhas casadas = id inexistente OU de outra loja: a mesma
    // frase para os dois (sem oráculo). Antes disso a UI dizia "salvo" por uma
    // escrita que não aconteceu. `count` ausente (`null`/`undefined`) NÃO
    // recusa — a recusa é em `0` ESTRITO (R4).
    if (count === 0) return { ok: false, erro: MSG_SALVAR };

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCardapio]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/**
 * RN-03 — mexe SÓ em `ativo`. Dias, horários e prazo continuam gravados e um
 * clique reverte tudo: desligar é guardar o cardápio de inverno até o ano que
 * vem, não apagá-lo.
 */
export async function ligarDesligarCardapio(
  id: string,
  ativo: boolean,
): Promise<ResultadoCardapio> {
  if (typeof ativo !== "boolean") return { ok: false, erro: MSG_SALVAR };
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA };

    const { error, count } = await supabase
      .from("cardapios")
      .update({ ativo }, { count: "exact" })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[ligarDesligarCardapio]", error);
      return { ok: false, erro: MSG_SALVAR };
    }
    // [274 · D8] Mesma regra de `atualizarCardapio`.
    if (count === 0) return { ok: false, erro: MSG_SALVAR };

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[ligarDesligarCardapio]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/**
 * Remove o cardápio. RECUSADA enquanto existir produto exclusivo que ficaria
 * sem nenhum cardápio (RN-14), com a mensagem que diz o número e a saída —
 * `converterExclusivosParaMenu` é o "converter os N para o menu" do diálogo.
 *
 * Por que RECUSAR e não converter sozinha: `visibilidade` é declaração do
 * lojista e o sistema NUNCA a muda por conta própria (§Fora do Escopo da
 * issue 255 e §Atores da spec). Converter na mesma transação faria a remoção
 * de um cardápio devolver silenciosamente pratos de temporada ao menu o ano
 * inteiro — o oposto do que o lojista declarou. A conversão existe, é um
 * clique, e é ELE quem dá o clique.
 *
 * [284] O `modo` é a escolha DECLARADA no diálogo, e só existe porque continua
 * sendo o lojista quem decide: `manter` (ausente ou explícito) é o parágrafo
 * acima, inalterado; `arquivar` tira os órfãos da vitrine de forma reversível
 * (`oculto = true` + `visibilidade = 'menu'`); `cascata` os APAGA. Nos dois
 * modos novos a lista é recalculada aqui (RN-02) e a posse do cardápio é
 * provada antes (RN-04).
 */
export async function removerCardapio(
  id: string,
  modo: ModoRemocaoExclusivos = "manter",
): Promise<ResultadoRemocao> {
  if (!schemaIdCardapio.safeParse(id).success) {
    return { ok: false, erro: MSG_INVALIDO, exclusivos: 0 };
  }
  // [284 · RN-01] Parse do modo ANTES de qualquer I/O, e `default` que recusa:
  // um valor desconhecido NUNCA cai num ramo destrutivo.
  const modoParsed = schemaModoRemocao.safeParse(modo);
  if (!modoParsed.success) {
    return { ok: false, erro: MSG_INVALIDO, exclusivos: 0 };
  }
  const escolha = modoParsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA, exclusivos: 0 };

    if (escolha === "manter") {
      const orfaos = await buscarProdutosQueFicariamOrfaos(
        supabase,
        loja.id,
        id,
      );
      if (orfaos.length > 0) {
        return {
          ok: false,
          erro: mensagemExclusivos(orfaos.length),
          exclusivos: orfaos.length,
        };
      }
    } else {
      // [284 · RN-04] Nos modos que ESCREVEM nos produtos, a posse do cardápio
      // vem antes da leitura: sem ela, um id alheio faria o recálculo rodar
      // sobre outro tenant. Alheio e inexistente saem pela MESMA frase (§14).
      if (!(await cardapioPertenceALoja(supabase, loja.id, id))) {
        return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
      }

      // RN-02: a lista é SEMPRE derivada no servidor — a action não tem onde
      // pendurar ids do cliente, e no modo `cascata` vazar aqui é irreversível.
      const orfaos = await buscarProdutosQueFicariamOrfaos(
        supabase,
        loja.id,
        id,
      );
      if (orfaos.length > 0) {
        // RN-06: produtos PRIMEIRO, cardápio DEPOIS — a ordem inversa derruba a
        // transação no trigger deferido. Um único statement escopado por
        // `loja_id` (+ 2º cinto de `visibilidade`), como em
        // `converterExclusivosParaMenu`: N chamadas de action por id seriam N
        // round trips e uma falha parcial no meio do laço.
        const alvo = supabase.from("produtos");
        const escrita =
          escolha === "arquivar"
            ? // RN-05: exatamente dois campos. `disponivel` é "esgotado" (que
              // CONTINUA visível na vitrine) e não entra aqui; `visibilidade`
              // precisa sair de 'cardapio' no MESMO UPDATE, senão o produto
              // vira exclusivo órfão e o COMMIT seguinte é recusado.
              alvo.update({ oculto: true, visibilidade: "menu" })
            : alvo.delete();
        const { error: erroProdutos } = await escrita
          .eq("loja_id", loja.id)
          .eq("visibilidade", "cardapio")
          .in("id", orfaos);
        if (erroProdutos) {
          console.error("[removerCardapio]", erroProdutos);
          // Sem seguir para o request 2: o cardápio continua existindo, e o
          // estado é reconciliável numa segunda tentativa.
          return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
        }
      }
    }

    const { error, count } = await supabase
      .from("cardapios")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[removerCardapio]", error);
      // Backstop: o trigger deferido só falha no COMMIT, depois da leitura
      // acima. O lojista recebe a frase acionável, não o 23000 cru.
      if (ehErroDeExclusivoOrfao(error)) {
        return { ok: false, erro: MSG_EXCLUSIVOS_SEM_NUMERO, exclusivos: 0 };
      }
      return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
    }
    // [274 · D8] Zero linhas apagadas = id inexistente OU de outra loja.
    if (count === 0) return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[removerCardapio]", e);
    if (ehErroDeExclusivoOrfao(e)) {
      return { ok: false, erro: MSG_EXCLUSIVOS_SEM_NUMERO, exclusivos: 0 };
    }
    return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
  }
}

/**
 * A saída oferecida pelo diálogo de remoção: os produtos que FICARIAM ÓRFÃOS
 * voltam a ser do menu. Sempre permitido — é a saída de qualquer estado preso
 * (§Páginas, `/painel/produtos`).
 *
 * O escopo é `buscarProdutosQueFicariamOrfaos` — o MESMO helper que produz o número
 * que a recusa anuncia e que o botão repete ("converter os N para o menu").
 * Converter todos os exclusivos VINCULADOS escreveria também em quem está
 * pendurado em outro cardápio e não corre risco nenhum: esse produto viraria
 * `menu` e passaria a aparecer o ano inteiro sem estar em cardápio sazonal
 * algum — o oposto do que o lojista declarou, e um número a mais do que o
 * botão prometeu. O sistema só mexe na `visibilidade` que o lojista mandou
 * mexer, e exatamente nessa.
 *
 * `visibilidade = 'menu'` é o único valor escrito; nenhum outro campo do
 * produto é tocado, e o UPDATE é escopado por `loja_id` ALÉM da RLS.
 */
export async function converterExclusivosParaMenu(
  cardapioId: string,
): Promise<ResultadoCardapio> {
  if (!schemaIdCardapio.safeParse(cardapioId).success) {
    return { ok: false, erro: MSG_INVALIDO };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA };

    // [274 · D8] A posse do cardápio ANTES de ler os órfãos: sem ela, um
    // `cardapioId` alheio faria a leitura rodar sobre um cardápio de OUTRA
    // loja (que devolve vazio pela RLS) e a action responderia `{ ok: true }`
    // por uma conversão que não aconteceu. Alheio e inexistente: a mesma frase.
    if (!(await cardapioPertenceALoja(supabase, loja.id, cardapioId))) {
      return { ok: false, erro: MSG_CONVERTER };
    }

    const orfaos = await buscarProdutosQueFicariamOrfaos(
      supabase,
      loja.id,
      cardapioId,
    );
    if (orfaos.length === 0) return { ok: true };

    const { error } = await supabase
      .from("produtos")
      .update({ visibilidade: "menu" })
      .eq("loja_id", loja.id)
      .eq("visibilidade", "cardapio")
      .in("id", orfaos);
    if (error) {
      console.error("[converterExclusivosParaMenu]", error);
      return { ok: false, erro: MSG_CONVERTER };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[converterExclusivosParaMenu]", e);
    return { ok: false, erro: MSG_CONVERTER };
  }
}

// ═══════════════ [274] A agenda do VÍNCULO — RN-10, RN-11, RN-12, RN-14 ═════

/**
 * Define em QUE DIAS DA SEMANA um item aparece dentro de um cardápio — a única
 * via de escrita de `cardapio_produtos.dias_semana` no painel do lojista.
 *
 * A posse é provada PELA PRÓPRIA ESCRITA (D6): o UPDATE é
 * `where loja_id ∧ cardapio_id ∧ produto_id` com `count: "exact"`, e
 * `count === 0` É a recusa. Isso é estritamente mais forte que o gate
 * `cardapioPertenceALoja` das actions de lote — que existe lá porque
 * `ON CONFLICT DO NOTHING` descarta a linha antes da FK e porque um DELETE de
 * zero linhas termina mudo — e custa um round trip a MENOS, sem a janela
 * TOCTOU entre a leitura e a escrita.
 *
 * Contrato da fronteira, o mesmo do resto do módulo: parse zod antes de
 * qualquer I/O (o `.strict()` recusa um `loja_id` pendurado no payload —
 * RN-10), `loja_id` de `buscarLojaDoDono`, client AUTENTICADO, e UMA frase
 * (`MSG_DIAS_DO_VINCULO`) para payload fora de forma, vínculo inexistente,
 * vínculo de outra loja e erro de banco — alheio e inexistente byte a byte
 * iguais (`seguranca.md` §14). O `23514` do CHECK de domínio vai cru para o
 * log, nunca para a tela.
 *
 * RN-11: a REPRESENTAÇÃO é decidida no servidor por `normalizarDiasDoVinculo`
 * — `[]` vira `NULL` ("todos os dias do cardápio"), `[1,1,3]` e `[3,1]` viram
 * `[1,3]`.
 */
export async function definirDiasDoVinculo(
  payload: unknown,
): Promise<Resultado> {
  const parsed = schemaDiasDoVinculo.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_DIAS_DO_VINCULO };
  const { cardapio_id, produto_id, dias_semana } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_DIAS_DO_VINCULO };

    const { error, count } = await supabase
      .from("cardapio_produtos")
      .update(
        { dias_semana: normalizarDiasDoVinculo(dias_semana) },
        { count: "exact" },
      )
      .eq("loja_id", loja.id)
      .eq("cardapio_id", cardapio_id)
      .eq("produto_id", produto_id);
    if (error) {
      console.error("[definirDiasDoVinculo]", error);
      return { ok: false, erro: MSG_DIAS_DO_VINCULO };
    }
    // Sem log: `count === 0` não é erro de servidor, é um id que não existe
    // NESTA loja. `count` ausente não recusa (R4).
    if (count === 0) return { ok: false, erro: MSG_DIAS_DO_VINCULO };

    revalidarCaminhosDoCardapio(loja.slug, cardapio_id);
    return { ok: true };
  } catch (e) {
    console.error("[definirDiasDoVinculo]", e);
    return { ok: false, erro: MSG_DIAS_DO_VINCULO };
  }
}
