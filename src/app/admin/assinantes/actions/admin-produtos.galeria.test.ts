import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});
import { STORAGE_URL_PREFIX } from "@/lib/validacoes/storage";

/**
 * Fase RED (TDD) — galeria de imagens × CRUD ADMIN de produto
 * (`src/app/admin/assinantes/actions/admin-produtos.ts`).
 *
 * O trigger BEFORE de M4 vale também sob `service_role` (BYPASSRLS ignora RLS,
 * não trigger), então a via admin recebe a mesma recusa `imagem_fora_da_galeria`
 * (P0001) e o mesmo `40P01` da remoção concorrente. Paridade com o lojista via
 * `produto-contrato.ts`: frase da galeria / "Tente de novo", nunca o texto cru.
 *
 * RED por asserção: hoje toda falha de escrita vira a genérica. Mensagens em
 * literal (o `galeria-contrato.ts` ainda não existe).
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111";
const PRODUTO_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const FOTO = `${STORAGE_URL_PREFIX}produtos/${LOJA_ALVO}/ffffffff-ffff-ffff-ffff-ffffffffffff.webp`;

const MSG_FOTO_REMOVIDA_DA_GALERIA = "A foto escolhida foi removida da galeria. Escolha outra.";
const MSG_TENTE_DE_NOVO = "Não foi possível salvar. Tente de novo.";
const ERRO_TRIGGER = { code: "P0001", message: "imagem_fora_da_galeria" };
const ERRO_DEADLOCK = { code: "40P01", message: "deadlock detected" };

type Op = { tabela: string; escrita: boolean };
let respostaEscrita: { data: unknown; error: unknown; count?: number };

function makeChain() {
  return {
    from: (tabela: string) => {
      const op: Op = { tabela, escrita: false };
      const chain: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "single", "maybeSingle", "limit", "order"]) {
        chain[k] = () => chain;
      }
      for (const k of ["insert", "update", "delete", "upsert"]) {
        chain[k] = () => {
          op.escrita = true;
          return chain;
        };
      }
      chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(
          op.escrita && op.tabela === "produtos"
            ? respostaEscrita
            : { data: null, error: null, count: 1 },
        ).then(onF, onR);
      return chain;
    },
  };
}

const servico = makeChain();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => servico }));
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: async () => undefined,
  obterAdminUserId: () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const processarRemocoesPendentes = vi.fn();
vi.mock("@/lib/actions/galeria-pendentes", () => ({
  processarRemocoesPendentes: (...a: unknown[]) => processarRemocoesPendentes(...a),
}));

import { criarProdutoAdmin, atualizarProdutoAdmin, removerProdutoAdmin } from "./admin-produtos";

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
  vi.spyOn(console, "error").mockImplementation(() => {});
  respostaEscrita = { data: null, error: null, count: 1 };
  processarRemocoesPendentes.mockReset();
  processarRemocoesPendentes.mockResolvedValue(undefined);
});

describe("admin: pendentes da galeria processados na LOJA-ALVO (escopo, D5)", () => {
  // Sob service_role o `lojaId` passado aqui é o escopo da varredura, do remove
  // e do DELETE. Trocar por `id` (do produto) apontaria a limpeza para outro
  // tenant — e passava verde antes desta trava.
  it("atualizarProdutoAdmin bem-sucedido → processarRemocoesPendentes(svc, LOJA_ALVO)", async () => {
    const r = await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, payload());
    expect(r).toEqual({ ok: true });
    expect(processarRemocoesPendentes).toHaveBeenCalledTimes(1);
    expect(processarRemocoesPendentes).toHaveBeenCalledWith(servico, LOJA_ALVO);
  });

  it("removerProdutoAdmin bem-sucedido → processarRemocoesPendentes(svc, LOJA_ALVO)", async () => {
    const r = await removerProdutoAdmin(LOJA_ALVO, PRODUTO_ID);
    expect(r).toEqual({ ok: true });
    expect(processarRemocoesPendentes).toHaveBeenCalledTimes(1);
    expect(processarRemocoesPendentes).toHaveBeenCalledWith(servico, LOJA_ALVO);
  });

  it("escrita recusada → nenhum processamento de pendentes", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, payload());
    await removerProdutoAdmin(LOJA_ALVO, PRODUTO_ID);
    expect(processarRemocoesPendentes).not.toHaveBeenCalled();
  });
});

describe("admin: recusa do trigger de M4 → frase da galeria", () => {
  it("criarProdutoAdmin", async () => {
    respostaEscrita = { data: null, error: ERRO_TRIGGER };
    expect(await criarProdutoAdmin(LOJA_ALVO, payload())).toEqual({
      ok: false,
      erro: MSG_FOTO_REMOVIDA_DA_GALERIA,
    });
  });

  it("atualizarProdutoAdmin", async () => {
    respostaEscrita = { data: null, error: ERRO_TRIGGER };
    expect(await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, payload())).toEqual({
      ok: false,
      erro: MSG_FOTO_REMOVIDA_DA_GALERIA,
    });
  });
});

describe("admin: deadlock (40P01) → Tente de novo", () => {
  it("criarProdutoAdmin", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    expect(await criarProdutoAdmin(LOJA_ALVO, payload())).toEqual({ ok: false, erro: MSG_TENTE_DE_NOVO });
  });

  it("atualizarProdutoAdmin", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    expect(await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, payload())).toEqual({
      ok: false,
      erro: MSG_TENTE_DE_NOVO,
    });
  });

  it("removerProdutoAdmin", async () => {
    respostaEscrita = { data: null, error: ERRO_DEADLOCK };
    expect(await removerProdutoAdmin(LOJA_ALVO, PRODUTO_ID)).toEqual({
      ok: false,
      erro: MSG_TENTE_DE_NOVO,
    });
  });
});

describe("admin: nunca o texto cru", () => {
  it("nenhuma resposta carrega imagem_fora_da_galeria / deadlock / errcode", async () => {
    for (const erro of [ERRO_TRIGGER, ERRO_DEADLOCK]) {
      respostaEscrita = { data: null, error: erro };
      for (const r of [
        await criarProdutoAdmin(LOJA_ALVO, payload()),
        await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, payload()),
        await removerProdutoAdmin(LOJA_ALVO, PRODUTO_ID),
      ]) {
        expect(r.ok).toBe(false);
        expect(JSON.stringify(r)).not.toMatch(/imagem_fora_da_galeria|deadlock|40P01|P0001/);
      }
    }
  });
});
