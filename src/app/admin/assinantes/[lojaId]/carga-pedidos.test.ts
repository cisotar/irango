import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura da issue 138 — loader `carregarDashboardLojaAdmin(lojaId)` em
 * `src/app/admin/assinantes/[lojaId]/carga-pedidos.ts`. Espelha o padrão de
 * `carga-opcionais.test.ts`: mocks de `verificarAdminSaaS`, `createServiceClient`,
 * `next/navigation.notFound` e da query `listarPedidosDaLoja(client, lojaId)`;
 * `validarLojaIdAdmin` (083) NÃO é mockado — usa a implementação real (z.guid()).
 *
 * Invariantes provadas:
 *  RN-1 (fail-closed): `verificarAdminSaaS()` REJEITA → a exceção PROPAGA e
 *    NENHUMA leitura acontece (nem `createServiceClient`, nem `listarPedidosDaLoja`).
 *  Validação 083: `lojaId` não-UUID → `notFound()` ANTES de qualquer leitura —
 *    nem `verificarAdminSaaS` nem a query rodam.
 *  Ordem: `verificarAdminSaaS()` roda ANTES de `createServiceClient()`.
 *  Escopo (RN-2/3): a query recebe o `lojaId` validado — nunca `OUTRA_LOJA`.
 *  Retorno: repassa os pedidos mockados sem transformação.
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

// ── Query: listarPedidosDaLoja(client, lojaId). Capturamos os argumentos. ─────
const pedidosFake = [
  { id: "ped-1", loja_id: LOJA_ID, total: 1000, status: "novo", criado_em: "2026-07-03T00:00:00Z", nome_cliente: "Fulano" },
];
const listarPedidosDaLoja = vi.fn(async (_c: unknown, _id: string) => pedidosFake);
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  listarPedidosDaLoja: (c: unknown, id: string) => listarPedidosDaLoja(c, id),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()).

import { carregarDashboardLojaAdmin } from "./carga-pedidos";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarDashboardLojaAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    const falhaAdmin = new Error("acesso negado");
    verificarAdminSaaS.mockRejectedValueOnce(falhaAdmin);

    await expect(carregarDashboardLojaAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarPedidosDaLoja).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarDashboardLojaAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() SEM ler dados nem provar admin", async () => {
    await expect(carregarDashboardLojaAdmin("nao-e-uuid")).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    // A validação de formato precede o guard de admin neste loader.
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarPedidosDaLoja).not.toHaveBeenCalled();
  });
});

describe("carregarDashboardLojaAdmin — sucesso: escopo e retorno", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarDashboardLojaAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("a query é escopada pelo lojaId validado (nunca outra loja)", async () => {
    await carregarDashboardLojaAdmin(LOJA_ID);

    expect(listarPedidosDaLoja).toHaveBeenCalledTimes(1);
    const [clienteRecebido, idRecebido] = listarPedidosDaLoja.mock.calls[0]!;
    expect(idRecebido).toBe(LOJA_ID);
    expect(idRecebido).not.toBe(OUTRA_LOJA);
    expect(clienteRecebido).toBe(clientServico);
  });

  it("retorna os pedidos da query mockada sem transformação", async () => {
    const resultado = await carregarDashboardLojaAdmin(LOJA_ID);

    expect(resultado).toBe(pedidosFake);
  });

  it("loja sem pedidos: repassa lista vazia (não substitui por notFound nem lança)", async () => {
    listarPedidosDaLoja.mockResolvedValueOnce([]);

    const resultado = await carregarDashboardLojaAdmin(LOJA_ID);

    expect(resultado).toEqual([]);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarDashboardLojaAdmin — falha na query propaga (não é engolida)", () => {
  it("erro de listarPedidosDaLoja propaga ao chamador — não vira lista vazia silenciosa", async () => {
    const falhaQuery = new Error("erro de conexão com o banco");
    listarPedidosDaLoja.mockRejectedValueOnce(falhaQuery);

    await expect(carregarDashboardLojaAdmin(LOJA_ID)).rejects.toThrow(
      "erro de conexão com o banco",
    );
  });
});
