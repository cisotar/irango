import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura do loader `carregarCuponsAdmin(lojaId)` em
 * `src/app/admin/assinantes/[lojaId]/carga-cupons.ts` (issue 141). Espelha o
 * padrão de `carga-opcionais.test.ts`: mocks de `verificarAdminSaaS`,
 * `createServiceClient`, `next/navigation.notFound` e `listarCuponsDaLoja`;
 * `validarLojaIdAdmin` (083) NÃO é mockado — usa a implementação real (z.guid()).
 *
 * Invariantes provadas:
 *  RN-1 (fail-closed): `verificarAdminSaaS()` REJEITA → a exceção PROPAGA e
 *    NENHUMA leitura acontece (nem `createServiceClient`, nem `listarCuponsDaLoja`).
 *  Validação 083: `lojaId` não-UUID → `notFound()` ANTES de qualquer leitura —
 *    nem `verificarAdminSaaS` nem a query rodam.
 *  Ordem: `verificarAdminSaaS()` roda ANTES de `createServiceClient()`.
 *  Escopo (RN-2/3): a query recebe o `lojaId` validado — nunca `OUTRA_LOJA`.
 *  Passthrough: retorna o `Cupom[]` da query sem mapeamento.
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

// ── listarCuponsDaLoja: recebe (client, lojaId). Capturamos os argumentos. ────
const cuponsFake = [
  { id: "cup-1", loja_id: LOJA_ID },
  { id: "cup-2", loja_id: LOJA_ID },
];
const listarCuponsDaLoja = vi.fn(async (_c: unknown, _id: string) => cuponsFake);
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarCuponsDaLoja: (c: unknown, id: string) => listarCuponsDaLoja(c, id),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()).

import { carregarCuponsAdmin } from "./carga-cupons";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarCuponsAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    const falhaAdmin = new Error("acesso negado");
    verificarAdminSaaS.mockRejectedValueOnce(falhaAdmin);

    await expect(carregarCuponsAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarCuponsDaLoja).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarCuponsAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() SEM ler dados nem provar admin", async () => {
    await expect(carregarCuponsAdmin("nao-e-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarCuponsDaLoja).not.toHaveBeenCalled();
  });
});

describe("carregarCuponsAdmin — sucesso: escopo e passthrough", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarCuponsAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("escopa a query pelo lojaId validado (nunca outra loja)", async () => {
    await carregarCuponsAdmin(LOJA_ID);

    expect(listarCuponsDaLoja).toHaveBeenCalledTimes(1);
    const idRecebido = listarCuponsDaLoja.mock.calls[0]?.[1];
    expect(idRecebido).toBe(LOJA_ID);
    expect(idRecebido).not.toBe(OUTRA_LOJA);
  });

  it("retorna o Cupom[] da query sem mapeamento", async () => {
    const resultado = await carregarCuponsAdmin(LOJA_ID);

    expect(resultado).toBe(cuponsFake);
  });
});
