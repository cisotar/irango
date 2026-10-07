import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});
import { STORAGE_URL_PREFIX } from "@/lib/validacoes/storage";

/**
 * Fase RED (TDD) — galeria de imagens × CRUD de produto do LOJISTA
 * (`src/lib/actions/produto.ts`). specs/galeria-imagens-loja.md, página 3
 * ("Salvar o produto…", "Trocar ou remover a foto… apaga o recorte antigo"),
 * RN-G6, RN-G20 e casos-limite de remoção concorrente / deadlock.
 *
 *  - o trigger BEFORE de M4 recusa `foto_url` fora da galeria com
 *    `imagem_fora_da_galeria` (P0001) ⇒ a action devolve
 *    "A foto escolhida foi removida da galeria. Escolha outra.";
 *  - `40P01` (deadlock entre o save e a RPC de remoção) ⇒
 *    "Não foi possível salvar. Tente de novo.";
 *  - NUNCA o texto cru do banco;
 *  - depois do save/remoção bem-sucedido, a action processa os pendentes da
 *    loja (o trigger AFTER marcou o recorte antigo) — best-effort: falha não
 *    derruba o save.
 *
 * RED por asserção: `produto.ts` existe; hoje toda falha de escrita vira a
 * genérica e nenhum pendente é processado. Mensagens em literal porque
 * `galeria-contrato.ts` ainda não existe (mantém o arquivo coletável).
 */

const LOJA = "11111111-1111-1111-1111-111111111111";
const PRODUTO_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const FOTO = `${STORAGE_URL_PREFIX}produtos/${LOJA}/ffffffff-ffff-ffff-ffff-ffffffffffff.webp`;

const MSG_FOTO_REMOVIDA_DA_GALERIA = "A foto escolhida foi removida da galeria. Escolha outra.";
const MSG_TENTE_DE_NOVO = "Não foi possível salvar. Tente de novo.";

const ERRO_TRIGGER = { code: "P0001", message: "imagem_fora_da_galeria" };
const ERRO_DEADLOCK = { code: "40P01", message: "deadlock detected" };

type Op = { tabela: string; insert?: unknown; update?: unknown; deleted?: boolean };
let ops: Op[];
let respostaEscrita: { data: unknown; error: unknown };

function makeChain() {
  return {
    from: (tabela: string) => {
      const op: Op = { tabela };
      ops.push(op);
      const chain: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "single", "maybeSingle", "limit", "order"]) {
        chain[k] = () => chain;
      }
      chain.insert = (row: unknown) => {
        op.insert = row;
        return chain;
      };
      chain.update = (row: unknown) => {
        op.update = row;
        return chain;
      };
      chain.delete = () => {
        op.deleted = true;
        return chain;
      };
      chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        const escrita = op.insert !== undefined || op.update !== undefined || op.deleted;
        return Promise.resolve(
          escrita ? respostaEscrita : { data: null, error: null },
        ).then(onF, onR);
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const authClient = makeChain();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => authClient }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ __role: "service" }) }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const processarRemocoesPendentes = vi.fn();
vi.mock("@/lib/actions/galeria-pendentes", () => ({
  processarRemocoesPendentes: (...a: unknown[]) => processarRemocoesPendentes(...a),
}));

/**
 * "Falha não derruba o save": a garantia é do helper REAL, que nunca rejeita
 * (provado em galeria-pendentes.test.ts). Aqui ele roda de verdade contra um
 * client cuja varredura cai — o caller não tem `.catch` próprio, então se o
 * helper voltasse a rejeitar este teste ficaria vermelho.
 */
async function pendentesReaisComFalha(): Promise<void> {
  const real = await vi.importActual<typeof import("@/lib/actions/galeria-pendentes")>(
    "@/lib/actions/galeria-pendentes",
  );
  const clientQueCai = {
    rpc: () => {
      throw new Error("storage fora do ar");
    },
  };
  processarRemocoesPendentes.mockImplementation((_client: unknown, lojaId: string) =>
    real.processarRemocoesPendentes(clientQueCai as never, lojaId),
  );
}

import { criarProduto, atualizarProduto, removerProduto } from "./produto";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA, dono_id: "dono-1", slug: "minha-loja", ativo: true, timezone: "America/Sao_Paulo" };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    nome: "X-Burger",
    descricao: "delícia",
    preco: 25.9,
    categoria_id: null,
    disponivel: true,
    oculto: false,
    visibilidade: "menu",
    ordem: 0,
    foto_url: FOTO,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  ops = [];
  respostaEscrita = { data: null, error: null };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
  processarRemocoesPendentes.mockResolvedValue(undefined);
});

describe("tradução da recusa do trigger de M4 (imagem_fora_da_galeria)", () => {
  it("criarProduto → MSG_FOTO_REMOVIDA_DA_GALERIA", async () => {
    respostaEscrita = { data: null, error: ERRO_TRIGGER };
    expect(await criarProduto(payload())).toEqual({ ok: false, erro: MSG_FOTO_REMOVIDA_DA_GALERIA });
  });

  it("atualizarProduto → MSG_FOTO_REMOVIDA_DA_GALERIA", async () => {
    respostaEscrita = { data: null, error: ERRO_TRIGGER };
    expect(await atualizarProduto(PRODUTO_ID, payload())).toEqual({
      ok: false,
      erro: MSG_FOTO_REMOVIDA_DA_GALERIA,
    });
  });

  it("mesmo texto com outro errcode NÃO vira a frase da galeria (genérica)", async () => {
    respostaEscrita = { data: null, error: { code: "23505", message: "imagem_fora_da_galeria" } };
    const r = await criarProduto(payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar o produto." });
  });
});

describe("tradução do deadlock (40P01) — remoção concorrente com troca entre cópias", () => {
  it("criarProduto → MSG_TENTE_DE_NOVO", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    expect(await criarProduto(payload())).toEqual({ ok: false, erro: MSG_TENTE_DE_NOVO });
  });

  it("atualizarProduto → MSG_TENTE_DE_NOVO", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    expect(await atualizarProduto(PRODUTO_ID, payload())).toEqual({ ok: false, erro: MSG_TENTE_DE_NOVO });
  });

  it("removerProduto → MSG_TENTE_DE_NOVO", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    expect(await removerProduto(PRODUTO_ID)).toEqual({ ok: false, erro: MSG_TENTE_DE_NOVO });
  });
});

describe("nunca o texto cru do banco", () => {
  it.each([
    ["criar", () => criarProduto(payload())],
    ["atualizar", () => atualizarProduto(PRODUTO_ID, payload())],
    ["remover", () => removerProduto(PRODUTO_ID)],
  ])("%s: resposta não contém imagem_fora_da_galeria / deadlock / errcode", async (_r, chamar) => {
    for (const erro of [ERRO_TRIGGER, ERRO_DEADLOCK]) {
      respostaEscrita = { data: null, error: erro };
      const r = await chamar();
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/imagem_fora_da_galeria|deadlock|40P01|P0001/);
    }
  });
});

describe("processa pendentes depois do save (D5, RN-G20) — best-effort", () => {
  it("atualizarProduto bem-sucedido processa os pendentes da loja da sessão", async () => {
    const r = await atualizarProduto(PRODUTO_ID, payload());
    expect(r.ok).toBe(true);
    expect(processarRemocoesPendentes).toHaveBeenCalledWith(authClient, LOJA);
  });

  it("removerProduto bem-sucedido processa os pendentes (o recorte do produto excluído)", async () => {
    const r = await removerProduto(PRODUTO_ID);
    expect(r.ok).toBe(true);
    expect(processarRemocoesPendentes).toHaveBeenCalledWith(authClient, LOJA);
  });

  it("falha ao processar pendentes NÃO derruba o save", async () => {
    await pendentesReaisComFalha();
    const r = await atualizarProduto(PRODUTO_ID, payload());
    expect(processarRemocoesPendentes).toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });

  it("falha ao processar pendentes NÃO derruba a remoção", async () => {
    await pendentesReaisComFalha();
    const r = await removerProduto(PRODUTO_ID);
    expect(processarRemocoesPendentes).toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });
});
