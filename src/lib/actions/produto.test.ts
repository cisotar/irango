import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";
// Issue 072: garante base de URL válida ANTES da avaliação de storage.ts (deriva
// STORAGE_URL_PREFIX de NEXT_PUBLIC_SUPABASE_URL, indefinida no runner). vi.hoisted
// roda antes dos imports ESM, então a constante é avaliada com a base correta.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});
import { STORAGE_URL_PREFIX } from "@/lib/validacoes/storage";

/**
 * Fase RED (TDD) da issue 031 — CRUD de produtos e categorias do LOJISTA.
 * As actions são STUBs (`throw 'TODO: GREEN'`), então TODA expectativa abaixo
 * FALHA hoje — esse é o RED. A implementação é da fase GREEN (executar).
 *
 * Foco de segurança (issue 031 + seguranca.md §2/§14):
 *  - valida schemaProduto/schemaCategoria ANTES de qualquer I/O (lixo nem chega
 *    ao banco) — preço negativo, NaN, >2 casas, nome vazio são barrados;
 *  - usa o client AUTENTICADO (createClient), RLS produtos_escrita_propria /
 *    categorias_escrita_propria isola por dono — NUNCA service_role;
 *  - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload —
 *    payload com loja_id de OUTRA loja é IGNORADO;
 *  - categoria_id (quando informada) deve pertencer à PRÓPRIA loja. A RLS de
 *    produtos só verifica produtos.loja_id (não a posse da categoria) e a FK só
 *    garante que a categoria EXISTE — logo a action valida a posse para barrar
 *    referência cross-loja;
 *  - remover categoria deixa os produtos com categoria_id NULL (FK ON DELETE
 *    SET NULL no banco — a action apenas DELETE escopado pela RLS);
 *  - erro de banco → genérico, sem vazar e.message.
 *
 * Padrão de mocks (espelha cupomGestao.test.ts — CRÍTICO p/ não repetir o bug do
 * mock): o CLIENT RAIZ resolvido por `await createClient()` NÃO é thenável; só os
 * NÓS retornados por `.from(...)` (a cadeia de query) terminam numa Promise.
 * `respostaBanco` é resolvido POR TABELA, pois a action faz um SELECT na tabela
 * `categorias` (checagem de posse) e depois um INSERT/UPDATE em `produtos`.
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111"; // loja do auth.uid()
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja de outro dono
const CAT_PROPRIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // categoria da loja do dono
const CAT_ALHEIA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // categoria de outra loja

// Captura do que cada operação manda ao banco, por TABELA tocada.
type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  deleted?: boolean;
  selected?: boolean;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Resposta simulada do terminador da cadeia, escolhida pela TABELA.
// Default: SELECT em `categorias` devolve a categoria própria; escrita ok.
let respostaPorTabela: Record<string, { data: unknown; error: unknown }>;

// Issue 175: `rpc(...)` mora no CLIENT RAIZ, não na cadeia de `.from(...)` —
// `reordenarCategorias` chama uma FUNÇÃO do banco, não uma tabela. Este ramo é
// aditivo: nenhum teste anterior toca `rpc`, então nada existente muda.
type ChamadaRpc = { nome: string; args: Record<string, unknown> };
let chamadasRpc: ChamadaRpc[];
let respostaRpc: { data: unknown; error: unknown };

function makeChain() {
  // Cada `.from(tabela)` cria UMA cadeia thenável, ligada à sua Op.
  const client: Record<string, unknown> = {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const queryChain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        queryChain[k] = (...args: unknown[]) => {
          if (k === "eq") op.filtros.push([args[0] as string, args[1]]);
          if (k === "in") op.filtros.push([args[0] as string, args[1]]);
          if (k === "select") op.selected = true;
          return queryChain;
        };
      };
      ["select", "eq", "in", "single", "maybeSingle", "limit", "order"].forEach(
        passthrough,
      );
      queryChain.insert = (row: Record<string, unknown>) => {
        op.insert = row;
        return queryChain;
      };
      queryChain.update = (row: Record<string, unknown>) => {
        op.update = row;
        return queryChain;
      };
      queryChain.delete = () => {
        op.deleted = true;
        return queryChain;
      };
      // Só a cadeia da query é thenável → resolve a resposta da SUA tabela.
      queryChain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(
          respostaPorTabela[tabela] ?? { data: null, error: null },
        ).then(onF);
      return queryChain;
    },
    // Terminador próprio: `rpc` resolve DIRETO numa Promise (não é cadeia).
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      return Promise.resolve(respostaRpc);
    },
  };
  return client;
}

const authClient = makeChain();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// service_role NÃO deve ser usado (escrita do lojista é RLS autenticada).
const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  criarProduto,
  atualizarProduto,
  removerProduto,
  alternarDisponibilidade,
  alternarOculto,
  alternarExibirImagens,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
  // Issue 175 (fase GREEN): a action existe, então o resolvedor por namespace
  // que o RED usava vira import direto — a ausência agora seria erro de tipo.
  reordenarCategorias,
} from "./produto";
import type { ResultadoGestaoCategoria } from "./produto";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

function payloadProduto(over: Record<string, unknown> = {}) {
  return {
    nome: "X-Burger",
    descricao: "delícia",
    preco: 25.9,
    categoria_id: null,
    disponivel: true,
    // Issue 085: schemaProduto passa a exigir `oculto` (boolean). Incluído na
    // base para manter os payloads dos testes existentes válidos.
    oculto: false,
    ordem: 0,
    ...over,
  };
}

function payloadCategoria(over: Record<string, unknown> = {}) {
  return { nome: "Lanches", ordem: 0, ...over };
}

// helper: a Op de escrita numa tabela (insert OU update OU delete).
function opEscrita(tabela: string): Op | undefined {
  return ops.find(
    (o) => o.tabela === tabela && (o.insert || o.update || o.deleted),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  respostaPorTabela = {
    // SELECT de posse: por padrão a categoria informada é da PRÓPRIA loja.
    categorias: { data: { id: CAT_PROPRIA, loja_id: LOJA_DONO }, error: null },
    produtos: { data: { id: "produto-novo" }, error: null },
  };
  chamadasRpc = [];
  respostaRpc = { data: 3, error: null };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
});

describe("criarProduto (Server Action — gestão do lojista)", () => {
  it("caminho feliz: valida + insere via client autenticado → { ok:true }", async () => {
    const r = await criarProduto(payloadProduto());
    expect(r).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(opEscrita("produtos")?.insert).toBeDefined();
  });

  it("loja_id é DERIVADO da loja do dono (buscarLojaDoDono), nunca do payload", async () => {
    await criarProduto(payloadProduto());
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(opEscrita("produtos")?.insert?.loja_id).toBe(LOJA_DONO);
  });

  it("ATAQUE: payload com loja_id de OUTRA loja é IGNORADO (produto nasce na do dono)", async () => {
    await criarProduto({ ...payloadProduto(), loja_id: LOJA_OUTRA });
    expect(opEscrita("produtos")?.insert?.loja_id).toBe(LOJA_DONO);
    expect(opEscrita("produtos")?.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("NÃO usa service_role (escrita do lojista passa pela RLS autenticada)", async () => {
    await criarProduto(payloadProduto());
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("ATAQUE: preço negativo rejeitado SEM tocar no banco (schemaProduto)", async () => {
    const r = await criarProduto(payloadProduto({ preco: -1 }));
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("ATAQUE: preço NaN rejeitado SEM tocar no banco", async () => {
    const r = await criarProduto(payloadProduto({ preco: Number.NaN }));
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("ATAQUE: nome vazio rejeitado SEM tocar no banco", async () => {
    const r = await criarProduto(payloadProduto({ nome: "   " }));
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("categoria_id da PRÓPRIA loja é aceito e persiste no insert", async () => {
    const r = await criarProduto(payloadProduto({ categoria_id: CAT_PROPRIA }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.insert?.categoria_id).toBe(CAT_PROPRIA);
  });

  it("ATAQUE: categoria_id de OUTRA loja é REJEITADO sem inserir o produto", async () => {
    // O SELECT de posse na tabela categorias não acha a categoria sob a loja do
    // dono (RLS não retorna categoria alheia / loja_id diverge).
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await criarProduto(payloadProduto({ categoria_id: CAT_ALHEIA }));
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  // foto_url (issue 072): flui via `...parsed.data` no insert. URL do Storage
  // persiste; URL externa é barrada no schema ANTES de tocar o banco.
  it("foto_url do Storage persiste no insert via parsed.data", async () => {
    const fotoUrl = `${STORAGE_URL_PREFIX}produtos/${LOJA_DONO}/foto.png`;
    const r = await criarProduto(payloadProduto({ foto_url: fotoUrl }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.insert?.foto_url).toBe(fotoUrl);
  });

  it('foto_url "" (form sem foto) persiste como null no insert', async () => {
    const r = await criarProduto(payloadProduto({ foto_url: "" }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.insert?.foto_url).toBeNull();
  });

  it("ATAQUE: foto_url externa rejeitada SEM tocar no banco", async () => {
    const r = await criarProduto(
      payloadProduto({ foto_url: "https://evil.com/x.png" }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("erro de banco → genérico, sem vazar e.message", async () => {
    respostaPorTabela.produtos = {
      data: null,
      error: { message: "senha postgres XYZ", code: "XX000" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarProduto(payloadProduto());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });

  // oculto (issue 085): flui via `...parsed.data` no insert (nenhum código novo
  // na action; basta o schema aceitar o campo).
  it("oculto=true persiste no insert via parsed.data", async () => {
    const r = await criarProduto(payloadProduto({ oculto: true }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.insert?.oculto).toBe(true);
  });

  it("ATAQUE: payload sem oculto é rejeitado SEM tocar no banco", async () => {
    const { oculto: _o, ...semOculto } = payloadProduto();
    const r = await criarProduto(semOculto);
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });
});

describe("atualizarProduto (Server Action — gestão do lojista)", () => {
  it("valida e atualiza o produto escopado por id via client autenticado", async () => {
    const r = await atualizarProduto("produto-1", payloadProduto({ preco: 30 }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update).toBeDefined();
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
  });

  it("ATAQUE: update NÃO troca loja_id para outra loja", async () => {
    await atualizarProduto("produto-1", {
      ...payloadProduto(),
      loja_id: LOJA_OUTRA,
    });
    const upd = opEscrita("produtos")?.update;
    if (upd && "loja_id" in upd) expect(upd.loja_id).toBe(LOJA_DONO);
    expect(upd?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("ATAQUE: preço negativo no update rejeitado SEM tocar no banco", async () => {
    const r = await atualizarProduto("produto-1", payloadProduto({ preco: -1 }));
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  // foto_url removida no form chega como "" → persiste null no update (072).
  it('foto_url "" (remoção da foto) persiste como null no update', async () => {
    const r = await atualizarProduto("produto-1", payloadProduto({ foto_url: "" }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update?.foto_url).toBeNull();
  });

  it("ATAQUE: trocar para categoria_id de OUTRA loja é rejeitado no update", async () => {
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await atualizarProduto(
      "produto-1",
      payloadProduto({ categoria_id: CAT_ALHEIA }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  // oculto (issue 085): persiste via `...parsed.data` no update.
  it("oculto=true persiste no update via parsed.data", async () => {
    const r = await atualizarProduto("produto-1", payloadProduto({ oculto: true }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update?.oculto).toBe(true);
  });
});

describe("alternarDisponibilidade (toggle público de visibilidade)", () => {
  it("atualiza apenas o flag disponivel escopado por id, via client autenticado", async () => {
    const r = await alternarDisponibilidade("produto-1", false);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update?.disponivel).toBe(false);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  // Regressão (RN-6-b, issue 085): disponibilidade e visibilidade são flags
  // SEPARADAS. alternarDisponibilidade não pode escrever `oculto`.
  it("alternarDisponibilidade NÃO escreve oculto", async () => {
    await alternarDisponibilidade("produto-1", false);
    expect(opEscrita("produtos")?.update).not.toHaveProperty("oculto");
  });
});

describe("alternarOculto (toggle de visibilidade na vitrine — issue 085)", () => {
  // Contrato espelhado de alternarDisponibilidade: client AUTENTICADO, escopo
  // por id, sem service_role, erro genérico. Escreve APENAS `oculto` (RN-6-b).
  it("atualiza apenas o flag oculto escopado por id, via client autenticado", async () => {
    const r = await alternarOculto("produto-1", true);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update?.oculto).toBe(true);
    // Não mexe em disponivel (flag independente).
    expect(opEscrita("produtos")?.update).not.toHaveProperty("disponivel");
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("NÃO usa service_role (escrita do lojista passa pela RLS autenticada)", async () => {
    await alternarOculto("produto-1", true);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  // Borda: boolean `false` é um valor válido e distinto de "ausente". Um bug
  // comum é tratar `oculto: false` como falsy e cair num branch de default —
  // este teste garante que `false` é gravado explicitamente, não perdido.
  it("oculto=false (reexibir produto) grava false, não é tratado como ausente", async () => {
    const r = await alternarOculto("produto-1", false);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update?.oculto).toBe(false);
  });

  it("erro de banco → genérico, sem vazar e.message", async () => {
    respostaPorTabela.produtos = {
      data: null,
      error: { message: "senha postgres XYZ", code: "XX000" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await alternarOculto("produto-1", true);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });

  // ATAQUE: um lojista tenta alternar `oculto` de produto de OUTRA loja.
  // O isolamento cross-loja efetivo é enforced pela RLS produtos_escrita_propria
  // no Postgres (não observável no unit com mock). Este caso valida o CONTRATO
  // que HABILITA a RLS: a escrita passa pelo client AUTENTICADO (nunca
  // service_role, que bypassaria a RLS) e é escopada por `.eq("id", id)`. O
  // isolamento real (linha alheia não muda) é coberto por teste de integração
  // RLS no Supabase local, se/quando a suíte de integração de produtos existir.
  it("ATAQUE: produto de OUTRA loja — escrita passa pelo client autenticado escopada por id (RLS isola no banco)", async () => {
    const idAlheio = "produto-de-outra-loja";
    await alternarOculto(idAlheio, true);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", idAlheio]);
  });
});

describe("removerProduto (Server Action — gestão do lojista)", () => {
  it("deleta o produto escopado por id via client autenticado (RLS isola por dono)", async () => {
    const r = await removerProduto("produto-1");
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.deleted).toBe(true);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

describe("criarCategoria (Server Action — gestão do lojista)", () => {
  it("caminho feliz: valida + insere via client autenticado → { ok:true }", async () => {
    const r = await criarCategoria(payloadCategoria());
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categorias")?.insert).toBeDefined();
  });

  it("loja_id é DERIVADO da loja do dono, nunca do payload", async () => {
    await criarCategoria(payloadCategoria());
    expect(opEscrita("categorias")?.insert?.loja_id).toBe(LOJA_DONO);
  });

  it("ATAQUE: payload com loja_id de OUTRA loja é IGNORADO", async () => {
    await criarCategoria({ ...payloadCategoria(), loja_id: LOJA_OUTRA });
    expect(opEscrita("categorias")?.insert?.loja_id).toBe(LOJA_DONO);
    expect(opEscrita("categorias")?.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("ATAQUE: nome vazio rejeitado SEM tocar no banco (schemaCategoria)", async () => {
    const r = await criarCategoria(payloadCategoria({ nome: "   " }));
    expect(r.ok).toBe(false);
    expect(opEscrita("categorias")).toBeUndefined();
  });

  it("NÃO usa service_role", async () => {
    await criarCategoria(payloadCategoria());
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

describe("atualizarCategoria (Server Action — gestão do lojista)", () => {
  it("valida e atualiza a categoria escopada por id via client autenticado", async () => {
    const r = await atualizarCategoria("cat-1", payloadCategoria({ nome: "Bebidas" }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categorias")?.update).toBeDefined();
    expect(opEscrita("categorias")?.filtros).toContainEqual(["id", "cat-1"]);
  });

  it("ATAQUE: update NÃO troca loja_id para outra loja", async () => {
    await atualizarCategoria("cat-1", {
      ...payloadCategoria(),
      loja_id: LOJA_OUTRA,
    });
    const upd = opEscrita("categorias")?.update;
    if (upd && "loja_id" in upd) expect(upd.loja_id).toBe(LOJA_DONO);
    expect(upd?.loja_id).not.toBe(LOJA_OUTRA);
  });
});

describe("alternarExibirImagens (toggle exibir/ocultar imagens por categoria)", () => {
  // Contrato espelhado de alternarOculto: client AUTENTICADO, escopo por id,
  // sem service_role, erro genérico. Escreve APENAS `exibir_imagens`.
  it("atualiza apenas o flag exibir_imagens escopado por id, via client autenticado", async () => {
    const r = await alternarExibirImagens("cat-1", false);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categorias")?.update?.exibir_imagens).toBe(false);
    expect(opEscrita("categorias")?.filtros).toContainEqual(["id", "cat-1"]);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("NÃO usa service_role (escrita do lojista passa pela RLS autenticada)", async () => {
    await alternarExibirImagens("cat-1", true);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("exibir_imagens=true grava true explicitamente", async () => {
    const r = await alternarExibirImagens("cat-1", true);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categorias")?.update?.exibir_imagens).toBe(true);
  });

  it("erro de banco → genérico, sem vazar e.message", async () => {
    respostaPorTabela.categorias = {
      data: null,
      error: { message: "senha postgres XYZ", code: "XX000" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await alternarExibirImagens("cat-1", false);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });
});

describe("removerCategoria (Server Action — gestão do lojista)", () => {
  it("deleta a categoria escopada por id via client autenticado", async () => {
    // FK categoria_id ON DELETE SET NULL: produtos ficam com categoria_id NULL
    // no banco — a action NÃO precisa mexer em produtos manualmente.
    const r = await removerCategoria("cat-1");
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categorias")?.deleted).toBe(true);
    expect(opEscrita("categorias")?.filtros).toContainEqual(["id", "cat-1"]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Fase RED (TDD) da issue 175 — Server Action `reordenarCategorias`.
 *
 * A action AINDA NÃO EXISTE (fase GREEN = `executar`). Todo caso abaixo falha
 * hoje em `acaoReordenar()` com a mensagem "ainda não é exportada".
 *
 * Por que esta action é CRÍTICA: ela recebe uma LISTA DE IDS ESCOLHIDA PELO
 * CLIENTE e escreve em lote — isso é AUTORIZAÇÃO, não CRUD. O padrão vizinho
 * `atualizarCategoria` busca a loja do dono mas NÃO filtra por ela; esta segue
 * o padrão CERTO de `categoriaPertenceALoja` (escopo explícito por `loja_id`
 * além da RLS), delegando a prova de posse à RPC atômica (sem TOCTOU).
 *
 * O isolamento entre lojas de verdade é provado em
 * `tests/migrations/rpc_reordenar_categorias.test.ts` (pglite, RLS real) — um
 * mock não tem linhas e não conseguiria afirmar "nada da loja B foi escrito".
 * O que ESTE arquivo prova é o contrato da fronteira: o que é validado antes
 * de qualquer I/O, o que é derivado no servidor e o que nunca vaza de volta.
 * ══════════════════════════════════════════════════════════════════════════
 */
describe("reordenarCategorias (Server Action — issue 175, autorização em lote)", () => {
  const CAT_1 = "11111111-2222-3333-4444-555555555551";
  const CAT_2 = "11111111-2222-3333-4444-555555555552";
  const CAT_3 = "11111111-2222-3333-4444-555555555553";

  type AcaoReordenar = (payload: unknown) => Promise<ResultadoGestaoCategoria>;

  /** A action sob teste (fase GREEN: import direto, sem resolução por namespace). */
  function acaoReordenar(): AcaoReordenar {
    return reordenarCategorias;
  }

  /** A única chamada de RPC esperada, quando há uma. */
  function rpcReordenar(): ChamadaRpc | undefined {
    return chamadasRpc.find((c) => c.nome === "reordenar_categorias");
  }

  // ─────────────────────────────────────────────────────────── A1
  it("[A1] caminho feliz: valida e chama UMA vez rpc('reordenar_categorias') → { ok:true }", async () => {
    const r = await acaoReordenar()([CAT_1, CAT_2, CAT_3]);
    expect(r).toEqual({ ok: true });
    // "uma única ida ao banco por operação": exatamente 1 chamada, não N updates.
    expect(chamadasRpc).toHaveLength(1);
    expect(chamadasRpc[0].nome).toBe("reordenar_categorias");
    expect(rpcReordenar()?.args.p_ids).toEqual([CAT_1, CAT_2, CAT_3]);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  // ─────────────────────────────────────────────────────────── A2
  it("[A2] p_loja_id é DERIVADO de buscarLojaDoDono (auth.uid()), nunca do payload", async () => {
    await acaoReordenar()([CAT_1, CAT_2]);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(rpcReordenar()?.args.p_loja_id).toBe(LOJA_DONO);
  });

  // ─────────────────────────────────────────────────────────── A3
  it("[A3] ATAQUE: chave `loja_id` pendurada no array é IGNORADA (p_loja_id continua o do dono)", async () => {
    // Array com propriedade extra: a fronteira RSC entrega o que o cliente
    // mandar. O schema zod (array puro) é o único portão — a chave hostil não
    // pode sobreviver ao parse nem chegar aos argumentos da RPC.
    const hostil: string[] & { loja_id?: string } = [CAT_1, CAT_2];
    hostil.loja_id = LOJA_OUTRA;

    await acaoReordenar()(hostil);

    const args = rpcReordenar()?.args;
    expect(args?.p_loja_id).toBe(LOJA_DONO);
    expect(args?.p_loja_id).not.toBe(LOJA_OUTRA);
    expect(JSON.stringify(args)).not.toContain(LOJA_OUTRA);
  });

  // ─────────────────────────────────────────────────────────── A4
  it("[A4] payload que não é array ({} / 'abc' / null) → { ok:false } e ZERO rpc", async () => {
    for (const lixo of [{}, "abc", null, 42, [CAT_1, 7]]) {
      chamadasRpc = [];
      const r = await acaoReordenar()(lixo);
      expect(r.ok).toBe(false);
      expect(chamadasRpc).toHaveLength(0);
    }
  });

  // ─────────────────────────────────────────────────────────── A5
  it("[A5] id fora do formato uuid → { ok:false } e ZERO rpc (lixo nem chega ao banco)", async () => {
    const r = await acaoReordenar()(["nao-e-uuid", CAT_2]);
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────── A6
  it("[A6] ids duplicados → { ok:false } e ZERO rpc (defesa em profundidade antes do row_count)", async () => {
    const r = await acaoReordenar()([CAT_1, CAT_1, CAT_3]);
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────── A7
  it("[A7] array com 1 id → { ok:false } e ZERO rpc (lista de 1 não tem ordem)", async () => {
    const r = await acaoReordenar()([CAT_1]);
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────── A8
  it("[A8] array acima do teto (201 ids) → { ok:false } e ZERO rpc (CWE-770)", async () => {
    const gigante = Array.from({ length: 201 }, () => crypto.randomUUID());
    const r = await acaoReordenar()(gigante);
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────── A9
  it("[A9] NÃO usa service_role (a escrita do lojista passa pela RLS autenticada)", async () => {
    await acaoReordenar()([CAT_1, CAT_2, CAT_3]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────── A10
  it("[A10] erro de banco → mensagem genérica, sem vazar error.message", async () => {
    // Mensagem única para id alheio / lista incompleta / erro de banco: distinguir
    // transformaria a action num oráculo de existência de id (seguranca.md §14).
    respostaRpc = {
      data: null,
      error: { message: "senha postgres XYZ", code: "P0001" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await acaoReordenar()([CAT_1, CAT_2, CAT_3]);
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(JSON.stringify(r)).not.toContain("senha");
    expect(JSON.stringify(r)).not.toContain("P0001");
    // O detalhe existe — mas só no log do servidor.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ─────────────────────────────────────────────────────────── A11
  it("[A11] buscarLojaDoDono → null → { ok:false, erro:'Loja não encontrada.' } e ZERO rpc", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await acaoReordenar()([CAT_1, CAT_2, CAT_3]);
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(chamadasRpc).toHaveLength(0);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 175, camada de aplicação:
 *
 *   src/lib/validacoes/produto.ts
 *     export const schemaReordenacaoCategorias =
 *       z.array(z.guid()).min(2).max(200)
 *        .refine((ids) => new Set(ids).size === ids.length, ...)
 *
 *   src/lib/actions/produto.ts
 *     export async function reordenarCategorias(
 *       payload: unknown,                      // `unknown` de propósito: tipo é
 *     ): Promise<ResultadoGestaoCategoria>     // apagado em runtime, o zod é o
 *                                              // único portão real.
 *
 *   Sequência obrigatória (espelha as demais actions do arquivo):
 *     1. safeParse ANTES de qualquer I/O        → falhou: "Não foi possível
 *                                                  salvar a ordem." [A4..A8]
 *     2. createClient() AUTENTICADO             → nunca service_role     [A9]
 *     3. buscarLojaDoDono(supabase)             → null: "Loja não encontrada."
 *                                                                       [A11]
 *     4. supabase.rpc("reordenar_categorias", { p_loja_id: loja.id,
 *                                               p_ids: parsed.data })   [A1..A3]
 *     5. error → console.error + mensagem genérica única                 [A10]
 *     6. revalidatePath("/painel/produtos") e revalidatePath("/loja/[slug]", "page")
 *        (NÃO usar CAMINHO_PAINEL: "/painel/cardapio" não existe como rota)
 *
 *   Casos que precisam passar: [A1]..[A11] aqui e [R1]..[R7] em
 *   tests/migrations/rpc_reordenar_categorias.test.ts.
 */
