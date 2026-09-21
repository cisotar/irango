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
 *  - **nenhum pre-check de posse em JS**: um `select` antes do `insert` seria
 *    TOCTOU e, pior, gravaria os ids válidos do lote, denunciando pela
 *    diferença entre pedido e resultado QUAIS ids existem em outra loja. A
 *    posse é provada DENTRO da transação: as FKs compostas de 20260920129000
 *    (`cardapio_produtos_produto_fk`, `cardapio_produtos_cardapio_fk`) derrubam
 *    a instrução inteira — tudo ou nada;
 *  - UMA mensagem genérica para id alheio, id inexistente, cardápio alheio e
 *    falha de banco. `23503`, nome de constraint e fragmento da RPC vão para o
 *    log do servidor, nunca para a tela (`seguranca.md` §14).
 */

import {
  schemaLoteDeProdutos,
  schemaLoteDeCategoria,
  schemaPreviaDeLote,
  schemaCardapio,
  ehMensagemDeVigencia,
  type DadosCardapio,
} from "@/lib/validacoes/cardapio";
import { instanteNoFuso } from "@/lib/utils/fusoLoja";
import { calcularFimDoPreset } from "@/lib/utils/calcularFimDoPreset";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; erro: string };

type Previa =
  | { ok: true; total: number; nomes: string[]; menu: number; cardapio: number }
  | { ok: false; erro: string };

/**
 * A ÚNICA mensagem que o lojista vê, para QUALQUER falha (RN-09). Mensagens
 * distintas por tipo de falha virariam oráculo de existência de id.
 */
const MSG_GENERICA =
  "Não foi possível aplicar o cardápio aos produtos selecionados.";

/** O diálogo mostra 6 nomes no desktop e 3 no mobile (design §10.3). */
const NOMES_NA_PREVIA = 6;

/**
 * RN-11: os três caminhos REAIS, e a vitrine pelo slug da PRÓPRIA loja. Nunca a
 * forma coringa `("/loja/[slug]", "page")`, que invalidaria o Router Cache da
 * vitrine de TODAS as lojas. `CAMINHO_PAINEL` de produto.ts:35
 * (`/painel/cardapio`, singular) não existe como rota — débito conhecido
 * (`architecture.md` §10), não reusado aqui de propósito.
 */
function revalidarCaminhosDoCardapio(slug: string): void {
  revalidatePath("/painel/cardapios");
  revalidatePath("/painel/produtos");
  revalidatePath(`/loja/${slug}`);
}

/**
 * Vincula uma SELEÇÃO EXPLÍCITA de produtos a um cardápio (RN-09).
 *
 * Uma única instrução com todos os ids: se qualquer um deles for de outra loja
 * ou inexistente, a FK composta derruba o lote inteiro e NENHUMA linha é
 * gravada — nem para os ids legítimos, nem na loja alheia. Um upsert por id
 * gravaria os bons e confirmaria, pela diferença, qual é o alheio.
 *
 * RN-10: idempotência vem do `on conflict do nothing` (`ignoreDuplicates`),
 * não de um SELECT prévio de "quem já está".
 */
export async function aplicarCardapioEmProdutos(
  payload: unknown,
): Promise<Resultado> {
  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };
  const { cardapio_id, produto_ids } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const linhas = produto_ids.map((produto_id) => ({
      loja_id: loja.id,
      cardapio_id,
      produto_id,
    }));

    const { error } = await supabase
      .from("cardapio_produtos")
      .upsert(linhas, {
        onConflict: "cardapio_id,produto_id",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error("[aplicarCardapioEmProdutos]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmProdutos]", e);
    return { ok: false, erro: MSG_GENERICA };
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
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };
  const { cardapio_id, categoria_id } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const { error } = await supabase.rpc("aplicar_cardapio_em_categoria", {
      p_loja_id: loja.id,
      p_cardapio_id: cardapio_id,
      p_categoria_id: categoria_id,
    });
    if (error) {
      console.error("[aplicarCardapioEmCategoria]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[aplicarCardapioEmCategoria]", e);
    return { ok: false, erro: MSG_GENERICA };
  }
}

/**
 * Desfaz o vínculo (D2). O DELETE é escopado pela loja DERIVADA além da RLS:
 * o mesmo escopo explícito que `categoriaPertenceALoja` aplica no CRUD. Usa o
 * MESMO zod da gravação — teto, unicidade e forma não têm versão frouxa aqui.
 */
export async function tirarDeCardapio(payload: unknown): Promise<Resultado> {
  const parsed = schemaLoteDeProdutos.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };
  const { cardapio_id, produto_ids } = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const { error } = await supabase
      .from("cardapio_produtos")
      .delete()
      .eq("loja_id", loja.id)
      .eq("cardapio_id", cardapio_id)
      .in("produto_id", produto_ids);
    if (error) {
      console.error("[tirarDeCardapio]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[tirarDeCardapio]", e);
    return { ok: false, erro: MSG_GENERICA };
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
  if (!parsed.success) return { ok: false, erro: MSG_GENERICA };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_GENERICA };

    const base = supabase
      .from("produtos")
      .select("id, nome, visibilidade")
      .eq("loja_id", loja.id);
    const consulta =
      "produto_ids" in parsed.data
        ? base.in("id", parsed.data.produto_ids)
        : base.eq("categoria_id", parsed.data.categoria_id);

    const { data, error } = await consulta;
    if (error) {
      console.error("[preverLoteAction]", error);
      return { ok: false, erro: MSG_GENERICA };
    }

    const linhas = data ?? [];
    return {
      ok: true,
      total: linhas.length,
      nomes: linhas.slice(0, NOMES_NA_PREVIA).map((p) => p.nome),
      menu: linhas.filter((p) => p.visibilidade === "menu").length,
      cardapio: linhas.filter((p) => p.visibilidade === "cardapio").length,
    };
  } catch (e) {
    console.error("[preverLoteAction]", e);
    return { ok: false, erro: MSG_GENERICA };
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

const MSG_SALVAR = "Não foi possível salvar o cardápio.";
const MSG_REMOVER = "Não foi possível remover o cardápio.";
const MSG_CONVERTER =
  "Não foi possível converter os produtos deste cardápio para o menu.";
const MSG_LOJA = "Loja não encontrada.";
const MSG_INVALIDO = "Cardápio inválido.";

/**
 * O fragmento LITERAL que o trigger de RN-14 (20260920131000) levanta no
 * COMMIT, com errcode 23000. É o backstop: a recusa legível abaixo é a primeira
 * barreira, mas ela lê ANTES da transação e o cascade pode orfanar um produto
 * vinculado no meio do caminho. Quando isso acontece o lojista recebe a MESMA
 * frase acionável, não um erro genérico nem o texto cru do Postgres.
 */
const FRAGMENTO_TRIGGER = "produto exclusivo sem cardapio";

type ResultadoCardapio = { ok: true } | { ok: false; erro: string };

/**
 * A remoção devolve quantos produtos exclusivos travam a operação, porque o
 * diálogo precisa desse número para oferecer "converter os N para o menu"
 * (§Páginas, `/painel/cardapios`). `exclusivos: 0` em qualquer outra falha.
 */
type ResultadoRemocao =
  | { ok: true }
  | { ok: false; erro: string; exclusivos: number };

function mensagemExclusivos(n: number): string {
  return n === 1
    ? "1 produto só aparece por causa deste cardápio e sumiria da vitrine. Converta esse produto para o menu antes de remover o cardápio."
    : `${n} produtos só aparecem por causa deste cardápio e sumiriam da vitrine. Converta esses produtos para o menu antes de remover o cardápio.`;
}

/** Erro do banco que é, na verdade, a recusa de RN-14 vinda do trigger. */
function ehErroDeExclusivoOrfao(erro: unknown): boolean {
  if (erro == null || typeof erro !== "object") return false;
  const e = erro as { code?: unknown; message?: unknown };
  return (
    typeof e.message === "string" && e.message.includes(FRAGMENTO_TRIGGER)
  );
}

/**
 * RN-04 — a linha que vai ao banco, com os dois campos de instante já no fuso
 * da LOJA. Recebe `timezone` por parâmetro: nenhuma leitura de relógio e
 * nenhum fuso do cliente entram aqui.
 */
function linhaDoCardapio(
  dados: DadosCardapio,
  timezone: string,
): DadosCardapio {
  if (dados.modo !== "prazo_fixo" || dados.prazo_inicio == null) return dados;

  const inicio = instanteNoFuso(dados.prazo_inicio, timezone);
  const fim =
    dados.prazo_preset === "customizado"
      ? // Único preset em que o fim digitado é aceito — e o zod já garantiu
        // que ele existe e é posterior ao início.
        instanteNoFuso(dados.prazo_fim as string, timezone)
      : calcularFimDoPreset(
          new Date(inicio),
          // `customizado` já saiu acima; o cast é o estreitamento que o tipo
          // do preset não expressa sozinho.
          dados.prazo_preset as "diario" | "semanal" | "mensal",
          timezone,
        ).toISOString();

  return { ...dados, prazo_inicio: inicio, prazo_fim: fim };
}

/** Parse → mensagem: só as frases de vigência de §9.6 são promovidas literais. */
function erroDeParseCardapio(
  issues: readonly { message: string }[],
): string {
  return issues.find((i) => ehMensagemDeVigencia(i.message))?.message ?? MSG_INVALIDO;
}

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
    const { error } = await supabase
      .from("cardapios")
      .update(linhaDoCardapio(parsed.data, loja.timezone))
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[atualizarCardapio]", error);
      return { ok: false, erro: MSG_SALVAR };
    }

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

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA };

    const { error } = await supabase
      .from("cardapios")
      .update({ ativo })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[ligarDesligarCardapio]", error);
      return { ok: false, erro: MSG_SALVAR };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[ligarDesligarCardapio]", e);
    return { ok: false, erro: MSG_SALVAR };
  }
}

/**
 * Os produtos que ficariam ÓRFÃOS se este cardápio sumisse: exclusivos
 * (`visibilidade = 'cardapio'`) cujo ÚNICO vínculo é ele. É exatamente a
 * condição que o trigger de RN-14 avalia no COMMIT — contar todos os
 * exclusivos vinculados recusaria também quem está em dois cardápios e não
 * corre risco nenhum.
 *
 * Ler antes não é oráculo: é dado do próprio lojista, sob a RLS dele.
 */
async function produtosQueFicariamOrfaos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lojaId: string,
  cardapioId: string,
): Promise<string[]> {
  const vinculados = await produtosVinculados(supabase, lojaId, cardapioId);
  if (vinculados.length === 0) return [];

  const { data: exclusivos, error: erroProdutos } = await supabase
    .from("produtos")
    .select("id")
    .eq("loja_id", lojaId)
    .eq("visibilidade", "cardapio")
    .in("id", vinculados);
  if (erroProdutos) throw erroProdutos;
  const ids = (exclusivos ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  // Todos os vínculos desses exclusivos, em QUALQUER cardápio da loja: quem
  // aparece só uma vez está pendurado apenas neste.
  const { data: todos, error: erroVinculos } = await supabase
    .from("cardapio_produtos")
    .select("produto_id, cardapio_id")
    .eq("loja_id", lojaId)
    .in("produto_id", ids);
  if (erroVinculos) throw erroVinculos;

  const outros = new Set(
    (todos ?? [])
      .filter((v) => v.cardapio_id !== cardapioId)
      .map((v) => v.produto_id),
  );
  return ids.filter((id) => !outros.has(id));
}

/** Os `produto_id` vinculados a este cardápio, sob a RLS do dono. */
async function produtosVinculados(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lojaId: string,
  cardapioId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("cardapio_produtos")
    .select("produto_id")
    .eq("loja_id", lojaId)
    .eq("cardapio_id", cardapioId);
  if (error) throw error;
  return (data ?? []).map((v) => v.produto_id);
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
 */
export async function removerCardapio(id: string): Promise<ResultadoRemocao> {
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA, exclusivos: 0 };

    const orfaos = await produtosQueFicariamOrfaos(supabase, loja.id, id);
    if (orfaos.length > 0) {
      return {
        ok: false,
        erro: mensagemExclusivos(orfaos.length),
        exclusivos: orfaos.length,
      };
    }

    const { error } = await supabase
      .from("cardapios")
      .delete()
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (error) {
      console.error("[removerCardapio]", error);
      // Backstop: o trigger deferido só falha no COMMIT, depois da leitura
      // acima. O lojista recebe a frase acionável, não o 23000 cru.
      if (ehErroDeExclusivoOrfao(error)) {
        return { ok: false, erro: mensagemExclusivos(1), exclusivos: 1 };
      }
      return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
    }

    revalidarCaminhosDoCardapio(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[removerCardapio]", e);
    if (ehErroDeExclusivoOrfao(e)) {
      return { ok: false, erro: mensagemExclusivos(1), exclusivos: 1 };
    }
    return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
  }
}

/**
 * A saída oferecida pelo diálogo de remoção: os produtos EXCLUSIVOS vinculados
 * a este cardápio voltam a ser do menu. Sempre permitido — é a saída de
 * qualquer estado preso (§Páginas, `/painel/produtos`).
 *
 * `visibilidade = 'menu'` é o único valor escrito; nenhum outro campo do
 * produto é tocado, e o UPDATE é escopado por `loja_id` ALÉM da RLS.
 */
export async function converterExclusivosParaMenu(
  cardapioId: string,
): Promise<ResultadoCardapio> {
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: MSG_LOJA };

    const vinculados = await produtosVinculados(supabase, loja.id, cardapioId);
    if (vinculados.length === 0) return { ok: true };

    const { error } = await supabase
      .from("produtos")
      .update({ visibilidade: "menu" })
      .eq("loja_id", loja.id)
      .eq("visibilidade", "cardapio")
      .in("id", vinculados);
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
