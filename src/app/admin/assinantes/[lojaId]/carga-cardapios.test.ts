import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura pós-GREEN da issue 269 (fase 5) — loaders `carregarCardapiosAdmin`
 * (pré-existente, auditoria 260/261) e `carregarCardapiosDoPainelAdmin` (novo)
 * em `src/app/admin/assinantes/[lojaId]/carga-cardapios.ts`. NENHUM dos dois
 * tinha teste dedicado até agora — espelha exatamente o padrão de
 * `carga-opcionais.test.ts` / `carga.test.ts`.
 *
 * Invariantes provadas (mesma ordem fail-closed dos demais loaders admin):
 *  - `lojaId` não-UUID → `notFound()` ANTES de qualquer leitura (nem prova de
 *    admin, nem service client, nem query);
 *  - `verificarAdminSaaS()` REJEITA → a exceção PROPAGA, nenhuma leitura corre;
 *  - `verificarAdminSaaS()` roda ANTES de `createServiceClient()`;
 *  - `carregarCardapiosDoPainelAdmin`: loja-alvo inexistente (`buscarLojaAdminPorId`
 *    → null) ⇒ `notFound()` — a MESMA resposta de `lojaId` inválido, sem
 *    distinção (`seguranca.md` §14: nenhum oráculo de existência);
 *  - toda query recebe o `lojaId` VALIDADO, nunca `OUTRA_LOJA`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";

const ordemChamadas: string[] = [];

const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

const clientServico = { marker: "svc-fake" };
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

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

const cardapiosComProdutosFake = {
  cardapios: [{ id: "card-1", loja_id: LOJA_ID }],
  vinculosPorProduto: new Map([
    ["prod-1", [{ cardapio: { id: "card-1" }, dias_semana: null }]],
  ]),
};
const buscarCardapiosComProdutos = vi.fn(async (_c: unknown, _id: string) => cardapiosComProdutosFake);

const cardapiosDoPainelFake = {
  cardapios: [{ id: "card-1", loja_id: LOJA_ID, menu: 2, exclusivos: 1 }],
  produtos: [{ id: "prod-1", nome: "X", visibilidade: "menu" }],
  vinculosPorProduto: new Map([
    ["prod-1", [{ cardapio: { id: "card-1" }, dias_semana: null }]],
  ]),
};
const buscarCardapiosDoPainel = vi.fn(async (_c: unknown, _id: string) => cardapiosDoPainelFake);
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: (c: unknown, id: string) => buscarCardapiosComProdutos(c, id),
  buscarCardapiosDoPainel: (c: unknown, id: string) => buscarCardapiosDoPainel(c, id),
}));

const lojaFake = { id: LOJA_ID, nome: "Loja Alvo", timezone: "America/Sao_Paulo" };
const buscarLojaAdminPorId = vi.fn(async (_c: unknown, _id: string) => lojaFake);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: (c: unknown, id: string) => buscarLojaAdminPorId(c, id),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()).

import { carregarCardapiosAdmin, carregarCardapiosDoPainelAdmin } from "./carga-cardapios";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
  buscarLojaAdminPorId.mockResolvedValue(lojaFake);
  buscarCardapiosComProdutos.mockResolvedValue(cardapiosComProdutosFake);
  buscarCardapiosDoPainel.mockResolvedValue(cardapiosDoPainelFake);
});

describe("carregarCardapiosAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregarCardapiosAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarCardapiosComProdutos).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarCardapiosAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() SEM ler dados nem provar admin", async () => {
    await expect(carregarCardapiosAdmin("nao-e-uuid")).rejects.toBeInstanceOf(NotFoundError);

    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarCardapiosComProdutos).not.toHaveBeenCalled();
  });
});

describe("carregarCardapiosAdmin — sucesso: escopo", () => {
  it("prova admin ANTES de elevar e lê buscarCardapiosComProdutos escopado pelo lojaId validado", async () => {
    const resultado = await carregarCardapiosAdmin(LOJA_ID);

    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
    expect(buscarCardapiosComProdutos).toHaveBeenCalledTimes(1);
    const idRecebido = buscarCardapiosComProdutos.mock.calls[0]?.[1];
    expect(idRecebido).toBe(LOJA_ID);
    expect(idRecebido).not.toBe(OUTRA_LOJA);
    expect(resultado).toEqual(cardapiosComProdutosFake);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// carregarCardapiosDoPainelAdmin (269, fase 5) — o gêmeo admin da LISTA de
// `/painel/cardapios`, com a loja-alvo + os dois números de D14.
// ═══════════════════════════════════════════════════════════════════════════

describe("carregarCardapiosDoPainelAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregarCardapiosDoPainelAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(buscarCardapiosDoPainel).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarCardapiosDoPainelAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() ANTES de provar admin ou ler", async () => {
    await expect(carregarCardapiosDoPainelAdmin("nao-e-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(buscarCardapiosDoPainel).not.toHaveBeenCalled();
  });
});

describe("carregarCardapiosDoPainelAdmin — loja-alvo inexistente", () => {
  it("buscarLojaAdminPorId → null ⇒ notFound(), SEM ler buscarCardapiosDoPainel", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce(null as never);

    await expect(carregarCardapiosDoPainelAdmin(LOJA_ID)).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1); // admin foi provado antes
    expect(buscarCardapiosDoPainel).not.toHaveBeenCalled();
  });

  // Sem oráculo de existência (`seguranca.md` §14): id de outra loja e id
  // inexistente produzem a MESMA resposta — porque a única diferença possível
  // (loja existe mas não é a URL pedida) nunca chega até aqui: quem decide é
  // sempre `buscarLojaAdminPorId(svc, idValidado)`, nunca um id do payload.
  it("id inexistente e 'loja de outra URL' são o MESMO ramo de código — nenhuma distinção possível", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce(null as never);
    const erroInexistente = await carregarCardapiosDoPainelAdmin(LOJA_ID).catch((e) => e);

    vi.clearAllMocks();
    buscarLojaAdminPorId.mockResolvedValueOnce(null as never);
    const erroOutraLoja = await carregarCardapiosDoPainelAdmin(OUTRA_LOJA).catch((e) => e);

    expect(erroInexistente).toBeInstanceOf(NotFoundError);
    expect(erroOutraLoja).toBeInstanceOf(NotFoundError);
  });
});

describe("carregarCardapiosDoPainelAdmin — sucesso: escopo e agregado", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarCardapiosDoPainelAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("buscarLojaAdminPorId e buscarCardapiosDoPainel recebem o lojaId VALIDADO, nunca OUTRA_LOJA", async () => {
    await carregarCardapiosDoPainelAdmin(LOJA_ID);

    expect(buscarLojaAdminPorId.mock.calls[0]?.[1]).toBe(LOJA_ID);
    expect(buscarCardapiosDoPainel.mock.calls[0]?.[1]).toBe(LOJA_ID);
    expect(buscarLojaAdminPorId.mock.calls[0]?.[1]).not.toBe(OUTRA_LOJA);
    expect(buscarCardapiosDoPainel.mock.calls[0]?.[1]).not.toBe(OUTRA_LOJA);
  });

  it("retorna o agregado com loja + os três campos de buscarCardapiosDoPainel", async () => {
    const resultado = await carregarCardapiosDoPainelAdmin(LOJA_ID);

    expect(resultado).toEqual({
      loja: lojaFake,
      cardapios: cardapiosDoPainelFake.cardapios,
      produtos: cardapiosDoPainelFake.produtos,
      vinculosPorProduto: cardapiosDoPainelFake.vinculosPorProduto,
    });
  });
});
