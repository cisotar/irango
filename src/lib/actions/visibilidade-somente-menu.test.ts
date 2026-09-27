// TDD RED-first — volta do P6 (auditoria da frequência de exibição, item 1,
// MÉDIO). Decisão do usuário, opção (a): TORNAR IMPOSSÍVEL a escrita de
// `produtos.visibilidade = 'cardapio'`.
//
// O buraco: a view `vitrine_produtos` esconde o produto 'cardapio' sem vínculo
// em cardápio ativo, mas `criarPedido`/`revisarCarrinho` ignoram `visibilidade`
// (S5, specs/frequencia-exibicao.md) e VENDEM o item. Se o lojista (ou o admin)
// ainda puder gravar 'cardapio', o item some da vitrine e continua comprável por
// quem tem o id. Com o cardápio morto, 'menu' é o único valor gravável — no zod,
// antes de qualquer I/O, nos dois mundos. Sem CHECK no banco (quebraria os
// testes [h]..[m] da 245, que semeiam 'cardapio' de propósito).
//
// Escrita coberta: INSERT (`schemaProduto`), UPDATE da linha (`schemaProdutoUpdate`)
// e lote (`schemaVisibilidadeEmLote`), lojista e admin.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  schemaProduto,
  schemaProdutoUpdate,
  schemaVisibilidadeEmLote,
} from "@/lib/validacoes/produto";

// ── Captura de I/O (os dois mundos) ──────────────────────────────────────────
let escritas: { mundo: string; tabela: string }[];

function makeClient(mundo: "admin" | "lojista") {
  return {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "single", "maybeSingle", "limit", "order"]) {
        q[k] = () => q;
      }
      for (const k of ["insert", "update", "upsert", "delete"]) {
        q[k] = () => {
          escritas.push({ mundo, tabela });
          return q;
        };
      }
      q.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve({ data: { id: "x" }, error: null, count: 1 }).then(onF);
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const createClient = vi.fn(async () => makeClient("lojista"));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const createServiceClient = vi.fn(() => makeClient("admin"));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => createServiceClient() }));

vi.mock("@/lib/supabase/queries/lojas", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buscarLojaDoDono: vi.fn(async () => ({
    id: "33333333-3333-4333-8333-333333333333",
    slug: "loja-do-dono",
    timezone: "America/Sao_Paulo",
  })),
  buscarLojaAdminPorId: vi.fn(async () => ({
    id: LOJA_ALVO,
    slug: "loja-alvo",
    timezone: "America/Sao_Paulo",
  })),
}));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  criarProduto,
  atualizarProduto,
  definirVisibilidadeEmProdutos,
} from "@/lib/actions/produto";
import {
  criarProdutoAdmin,
  atualizarProdutoAdmin,
  definirVisibilidadeEmProdutosAdmin,
} from "@/app/admin/assinantes/actions/admin-produtos";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";
const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const PRODUTO = {
  nome: "Feijoada",
  preco: 45,
  disponivel: true,
  oculto: false,
  ordem: 0,
};

beforeEach(() => {
  escritas = [];
  createClient.mockClear();
  createServiceClient.mockClear();
  verificarAdminSaaS.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("[P6-1] zod: só 'menu' é gravável em visibilidade", () => {
  it("schemaProduto (INSERT) recusa 'cardapio' e aceita 'menu' / ausente", () => {
    expect(schemaProduto.safeParse({ ...PRODUTO, visibilidade: "cardapio" }).success).toBe(false);
    expect(schemaProduto.safeParse({ ...PRODUTO, visibilidade: "menu" }).success).toBe(true);
    const semCampo = schemaProduto.safeParse(PRODUTO);
    expect(semCampo.success).toBe(true);
    expect(semCampo.data?.visibilidade).toBe("menu");
  });

  it("schemaProdutoUpdate (UPDATE) recusa 'cardapio' e aceita 'menu'", () => {
    expect(schemaProdutoUpdate.safeParse({ ...PRODUTO, visibilidade: "cardapio" }).success).toBe(
      false,
    );
    expect(schemaProdutoUpdate.safeParse({ ...PRODUTO, visibilidade: "menu" }).success).toBe(true);
  });

  it("schemaVisibilidadeEmLote recusa 'cardapio' e aceita 'menu'", () => {
    expect(
      schemaVisibilidadeEmLote.safeParse({ produto_ids: [P1], visibilidade: "cardapio" }).success,
    ).toBe(false);
    expect(
      schemaVisibilidadeEmLote.safeParse({ produto_ids: [P1], visibilidade: "menu" }).success,
    ).toBe(true);
  });
});

describe("[P6-1] lojista: 'cardapio' recusado ANTES de qualquer I/O", () => {
  it.each([
    ["criarProduto", () => criarProduto({ ...PRODUTO, visibilidade: "cardapio" })],
    ["atualizarProduto", () => atualizarProduto(P1, { ...PRODUTO, visibilidade: "cardapio" })],
    [
      "definirVisibilidadeEmProdutos",
      () => definirVisibilidadeEmProdutos({ produto_ids: [P1], visibilidade: "cardapio" }),
    ],
  ])("%s", async (_nome, chamar) => {
    const r = await chamar();
    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(escritas).toHaveLength(0);
  });
});

describe("[P6-1] admin: 'cardapio' recusado ANTES de prepararContextoAdmin", () => {
  it.each([
    ["criarProdutoAdmin", () => criarProdutoAdmin(LOJA_ALVO, { ...PRODUTO, visibilidade: "cardapio" })],
    [
      "atualizarProdutoAdmin",
      () => atualizarProdutoAdmin(LOJA_ALVO, P1, { ...PRODUTO, visibilidade: "cardapio" }),
    ],
    [
      "definirVisibilidadeEmProdutosAdmin",
      () =>
        definirVisibilidadeEmProdutosAdmin(LOJA_ALVO, { produto_ids: [P1], visibilidade: "cardapio" }),
    ],
  ])("%s", async (_nome, chamar) => {
    const r = await chamar();
    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(escritas).toHaveLength(0);
  });

  it("contraprova: 'menu' no lote admin passa e escreve na loja-alvo", async () => {
    const r = await definirVisibilidadeEmProdutosAdmin(LOJA_ALVO, {
      produto_ids: [P1],
      visibilidade: "menu",
    });
    expect(r).toEqual({ ok: true });
    expect(escritas).toContainEqual({ mundo: "admin", tabela: "produtos" });
  });
});
