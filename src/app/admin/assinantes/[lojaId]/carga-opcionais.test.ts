import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura pós-GREEN da issue 132 — loader `carregarOpcionaisAdmin(lojaId)` em
 * `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts`. Espelha exatamente o
 * padrão de teste de `carga.test.ts` (carregarLojaAdmin): mocks de
 * `verificarAdminSaaS`, `createServiceClient`, `next/navigation.notFound` e das
 * queries `(client, lojaId)`; `validarLojaIdAdmin` (083) NÃO é mockado — usa a
 * implementação real (z.guid()).
 *
 * Invariantes provadas:
 *  RN-1 (fail-closed): `verificarAdminSaaS()` REJEITA → a exceção PROPAGA e
 *    NENHUMA leitura acontece (nem `createServiceClient`, nem as 5 queries).
 *  Validação 083: `lojaId` não-UUID → `notFound()` ANTES de qualquer leitura —
 *    nem `verificarAdminSaaS` nem as queries rodam (a validação precede o guard
 *    de admin no loader, diferente de `carga.ts` que só notFound() depois de
 *    buscar a loja).
 *  Ordem: `verificarAdminSaaS()` roda ANTES de `createServiceClient()`.
 *  Escopo (RN-2/3): toda query recebe o `lojaId` validado — nunca `OUTRA_LOJA`.
 *  Derivação de `categoriaIds`: `buscarOpcionaisPorCategoriaDaLoja` recebe os
 *    ids de `buscarCategorias` (categorias de PRODUTO), não os de
 *    `buscarProdutosDoLojista` nem os de `buscarCategoriasOpcional` — a fonte
 *    errada quebraria silenciosamente o mapa `opcionaisPorCategoria` na page 143.
 *  Agregado: retorna os 6 campos com os dados das queries mockadas.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";

// Ordem das operações sensíveis, para provar RN-1 (admin antes de qualquer leitura).
const ordemChamadas: string[] = [];

// ── verificarAdminSaaS: default passa; negação via mockRejectedValueOnce. ──────
const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Registra ordem ao ser criado. ────
const clientServico = { marker: "svc-fake" };
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── notFound: como o real do Next, LANÇA (interrompe o fluxo). ─────────────────
class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
const notFound = vi.fn(() => {
  ordemChamadas.push("notFound");
  throw new NotFoundError();
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

// ── Queries: todas recebem (client, lojaId) — exceto buscarOpcionaisPorCategoriaDaLoja,
// que recebe (client, lojaId, categoriaIds). Capturamos os argumentos recebidos.
const categoriasOpcionalFake = [{ id: "oc-1", loja_id: LOJA_ID }];
const buscarCategoriasOpcional = vi.fn(async (_c: unknown, _id: string) => categoriasOpcionalFake);
const opcionaisFake = [{ id: "op-1", loja_id: LOJA_ID }];
const buscarOpcionaisDoLojista = vi.fn(async (_c: unknown, _id: string) => opcionaisFake);
const associacoesFake = [{ id: "assoc-1", loja_id: LOJA_ID }];
const buscarAssociacoesOpcional = vi.fn(async (_c: unknown, _id: string) => associacoesFake);
vi.mock("@/lib/supabase/queries/opcionais", () => ({
  buscarCategoriasOpcional: (c: unknown, id: string) => buscarCategoriasOpcional(c, id),
  buscarOpcionaisDoLojista: (c: unknown, id: string) => buscarOpcionaisDoLojista(c, id),
  buscarAssociacoesOpcional: (c: unknown, id: string) => buscarAssociacoesOpcional(c, id),
}));

// Categorias de PRODUTO — a fonte de `categoriaIds` derivada para o JOIN. ids
// deliberadamente distintos de qualquer id de produto/opcional, para detectar
// se o loader confundir a fonte da derivação.
const categoriasProdutoFake = [
  { id: "cat-prod-1", loja_id: LOJA_ID },
  { id: "cat-prod-2", loja_id: LOJA_ID },
];
const buscarCategorias = vi.fn(async (_c: unknown, _id: string) => categoriasProdutoFake);
vi.mock("@/lib/supabase/queries/categorias", () => ({
  buscarCategorias: (c: unknown, id: string) => buscarCategorias(c, id),
}));

const produtosFake = [{ id: "prod-1", loja_id: LOJA_ID }];
const buscarProdutosDoLojista = vi.fn(async (_c: unknown, _id: string) => produtosFake);
const opcionaisPorCategoriaFake = { "cat-prod-1": [{ categoriaOpcionalId: "oc-1" }] };
const buscarOpcionaisPorCategoriaDaLoja = vi.fn(
  async (_c: unknown, _id: string, _categoriaIds: string[]) => opcionaisPorCategoriaFake,
);
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosDoLojista: (c: unknown, id: string) => buscarProdutosDoLojista(c, id),
  buscarOpcionaisPorCategoriaDaLoja: (c: unknown, id: string, categoriaIds: string[]) =>
    buscarOpcionaisPorCategoriaDaLoja(c, id, categoriaIds),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()),
// que já existe. Garante que o loader recusa não-UUID via o helper canônico.

import { carregarOpcionaisAdmin } from "./carga-opcionais";

const queriesComDoisArgs = [
  buscarCategoriasOpcional,
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
  buscarCategorias,
  buscarProdutosDoLojista,
];
const todasAsQueries = [...queriesComDoisArgs, buscarOpcionaisPorCategoriaDaLoja];

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarOpcionaisAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    const falhaAdmin = new Error("acesso negado");
    verificarAdminSaaS.mockRejectedValueOnce(falhaAdmin);

    await expect(carregarOpcionaisAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarOpcionaisAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() SEM ler dados nem provar admin", async () => {
    await expect(carregarOpcionaisAdmin("nao-e-uuid")).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    // A validação de formato precede o guard de admin neste loader — diferente
    // de carga.ts (que só chama notFound() depois de buscar a loja).
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
  });
});

describe("carregarOpcionaisAdmin — sucesso: escopo e agregado", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarOpcionaisAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("TODA query de duas pontas é escopada pelo lojaId validado (nunca outra loja)", async () => {
    await carregarOpcionaisAdmin(LOJA_ID);

    for (const q of queriesComDoisArgs) {
      expect(q).toHaveBeenCalledTimes(1);
      const idRecebido = q.mock.calls[0]?.[1];
      expect(idRecebido).toBe(LOJA_ID);
      expect(idRecebido).not.toBe(OUTRA_LOJA);
    }
  });

  it("deriva categoriaIds de buscarCategorias (categorias de PRODUTO) — não de produtos nem de categoriasOpcional", async () => {
    await carregarOpcionaisAdmin(LOJA_ID);

    expect(buscarOpcionaisPorCategoriaDaLoja).toHaveBeenCalledTimes(1);
    const [clienteRecebido, lojaIdRecebido, categoriaIdsRecebidos] =
      buscarOpcionaisPorCategoriaDaLoja.mock.calls[0]!;
    expect(lojaIdRecebido).toBe(LOJA_ID);
    // Os únicos ids que fariam sentido são os de `categoriasProdutoFake` — se o
    // loader trocar a fonte (ex.: mapear produtos ou categoriasOpcional), este
    // array não bate.
    expect(categoriaIdsRecebidos).toEqual(["cat-prod-1", "cat-prod-2"]);
    expect(clienteRecebido).toBeDefined();
  });

  it("categoriasProduto vazia → categoriaIds [] repassado tal qual (não hardcoda nem pula a chamada)", async () => {
    buscarCategorias.mockResolvedValueOnce([]);

    await carregarOpcionaisAdmin(LOJA_ID);

    expect(buscarOpcionaisPorCategoriaDaLoja).toHaveBeenCalledTimes(1);
    const categoriaIdsRecebidos = buscarOpcionaisPorCategoriaDaLoja.mock.calls[0]?.[2];
    expect(categoriaIdsRecebidos).toEqual([]);
  });

  it("retorna o agregado com os 6 campos preenchidos pelas queries mockadas", async () => {
    const resultado = await carregarOpcionaisAdmin(LOJA_ID);

    expect(resultado).toEqual({
      categoriasOpcional: categoriasOpcionalFake,
      opcionais: opcionaisFake,
      categoriasProduto: categoriasProdutoFake,
      associacoes: associacoesFake,
      produtos: produtosFake,
      opcionaisPorCategoria: opcionaisPorCategoriaFake,
    });
  });
});
