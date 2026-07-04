import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * RED (fase /tdd) da issue 140 — loader `carregarPedidoDetalheAdmin(lojaId, id)`
 * em `src/app/admin/assinantes/[lojaId]/carga-pedido-detalhe.ts` (NÃO existe
 * ainda; será criado na fase GREEN). Espelha `carga-pedidos.test.ts`: mocks de
 * `verificarAdminSaaS`, `createServiceClient`, `next/navigation.notFound` e da
 * query `buscarPedidoDaLoja(svc, lojaId, id)`; `validarLojaIdAdmin` (083) NÃO é
 * mockado — usa a implementação real (z.guid()).
 *
 * Invariantes provadas (mapa de enforcement do plano técnico da 140):
 *  RN-1 (fail-closed): `verificarAdminSaaS()` REJEITA → a exceção PROPAGA e
 *    NENHUMA leitura/elevação acontece (nem `createServiceClient`, nem
 *    `buscarPedidoDaLoja`, nem `notFound`). Não eleva a service_role.
 *  Validação 083: `lojaId` não-UUID → `notFound()` ANTES de provar admin ou ler.
 *  Barreira cross-loja / inexistente / id inválido: `buscarPedidoDaLoja` → `null`
 *    (o duplo `.eq("loja_id").eq("id")` da 130 não casa) → loader `notFound()`.
 *    Anti-enumeração: "de outra loja" e "não existe" são indistinguíveis.
 *  Ordem: `verificarAdminSaaS()` roda ANTES de `createServiceClient()`.
 *  Escopo: `buscarPedidoDaLoja` recebe `(svc, lojaId, id)` — o lojaId validado,
 *    nunca `OUTRA_LOJA`.
 *  Sucesso: retorna o pedido da query sem transformação.
 *  Erro de query propaga (não vira notFound silencioso).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const PEDIDO_ID = "33333333-3333-3333-3333-333333333333";

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

// ── Query: buscarPedidoDaLoja(svc, lojaId, id). Capturamos os argumentos. ──────
const pedidoFake = {
  id: PEDIDO_ID,
  loja_id: LOJA_ID,
  status: "novo",
  total: 4200,
  nome_cliente: "Fulano de Tal",
  criado_em: "2026-07-03T00:00:00Z",
  itens_pedido: [{ id: "item-1", itens_pedido_opcionais: [] }],
};
const buscarPedidoDaLoja = vi.fn(
  async (
    _svc: unknown,
    _lojaId: string,
    _id: string,
  ): Promise<typeof pedidoFake | null> => pedidoFake,
);
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoDaLoja: (svc: unknown, lojaId: string, id: string) =>
    buscarPedidoDaLoja(svc, lojaId, id),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()).

import { carregarPedidoDetalheAdmin } from "./carga-pedido-detalhe";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarPedidoDetalheAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura/elevação (fail-closed)", async () => {
    const falhaAdmin = new Error("acesso negado");
    verificarAdminSaaS.mockRejectedValueOnce(falhaAdmin);

    await expect(carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID)).rejects.toThrow(
      "acesso negado",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarPedidoDaLoja).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarPedidoDetalheAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() SEM ler dados nem provar admin", async () => {
    await expect(
      carregarPedidoDetalheAdmin("nao-e-uuid", PEDIDO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    // A validação de formato precede o guard de admin neste loader.
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarPedidoDaLoja).not.toHaveBeenCalled();
  });
});

describe("carregarPedidoDetalheAdmin — barreira cross-loja / não encontrado", () => {
  it("pedido de OUTRA loja (query → null) vira notFound() — não vaza que existe alhures", async () => {
    // `buscarPedidoDaLoja` faz o duplo `.eq("loja_id").eq("id")` (130): id válido
    // de outra loja não casa o loja_id → null. O loader traduz isso em notFound().
    buscarPedidoDaLoja.mockResolvedValueOnce(null);

    await expect(
      carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(buscarPedidoDaLoja).toHaveBeenCalledTimes(1);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("pedido inexistente / id inválido (query → null) vira notFound()", async () => {
    buscarPedidoDaLoja.mockResolvedValueOnce(null);

    await expect(
      carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe("carregarPedidoDetalheAdmin — sucesso: ordem, escopo e retorno", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("a query é escopada pelo (svc, lojaId validado, id) — nunca outra loja", async () => {
    await carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID);

    expect(buscarPedidoDaLoja).toHaveBeenCalledTimes(1);
    const [svcRecebido, lojaIdRecebido, idRecebido] =
      buscarPedidoDaLoja.mock.calls[0]!;
    expect(svcRecebido).toBe(clientServico);
    expect(lojaIdRecebido).toBe(LOJA_ID);
    expect(lojaIdRecebido).not.toBe(OUTRA_LOJA);
    expect(idRecebido).toBe(PEDIDO_ID);
  });

  it("retorna o pedido da query mockada sem transformação", async () => {
    const resultado = await carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID);

    expect(resultado).toBe(pedidoFake);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarPedidoDetalheAdmin — falha na query propaga (não é engolida)", () => {
  it("erro de buscarPedidoDaLoja propaga ao chamador — não vira notFound silencioso", async () => {
    const falhaQuery = new Error("erro de conexão com o banco");
    buscarPedidoDaLoja.mockRejectedValueOnce(falhaQuery);

    await expect(carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID)).rejects.toThrow(
      "erro de conexão com o banco",
    );
    expect(notFound).not.toHaveBeenCalled();
  });
});
