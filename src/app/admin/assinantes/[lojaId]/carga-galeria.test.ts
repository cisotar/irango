import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura do loader `carregarGaleriaAdmin(lojaId)` (specs/galeria-imagens-loja.md,
 * página 2). Espelha `carga-cupons.test.ts`: mocks de `verificarAdminSaaS`,
 * `createServiceClient`, `next/navigation.notFound` e das queries de imagens;
 * `validarLojaIdAdmin` NÃO é mockado (implementação real, z.guid()).
 *
 * Invariantes provadas:
 *  Fail-closed: `verificarAdminSaaS()` rejeita → a exceção PROPAGA e nenhuma
 *    leitura acontece.
 *  Validação: `lojaId` não-UUID → `notFound()` antes de qualquer leitura.
 *  Ordem: `verificarAdminSaaS()` antes de `createServiceClient()`.
 *  Escopo: toda query (grade, contagem, uso) recebe o `lojaId` validado e o
 *    client de serviço.
 *  Selo é prévia: falha da RPC de uso não derruba a página (usos = []).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const IMG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

const paginaFake = {
  imagens: [
    {
      id: IMG,
      url: "https://exemplo.supabase.co/storage/v1/object/public/produtos/x.webp",
      miniatura_url: null,
      criado_em: "2026-10-06T12:00:00.000Z",
    },
  ],
  proximo_cursor: null,
};
const usosFake = [{ imagem_id: IMG, produtos_total: 1, produtos: [], na_logo: false }];

const listarImagensDaLojaAdmin = vi.fn(async (_c: unknown, _id: string) => paginaFake);
const contarOriginaisDaLoja = vi.fn(async (_c: unknown, _id: string) => 37);
const buscarUsoDasImagens = vi.fn(
  async (_c: unknown, _id: string, _ids: readonly string[]): Promise<unknown[]> => usosFake,
);
vi.mock("@/lib/supabase/queries/imagens", () => ({
  listarImagensDaLojaAdmin: (c: unknown, id: string) => listarImagensDaLojaAdmin(c, id),
  contarOriginaisDaLoja: (c: unknown, id: string) => contarOriginaisDaLoja(c, id),
  buscarUsoDasImagens: (c: unknown, id: string, ids: readonly string[]) =>
    buscarUsoDasImagens(c, id, ids),
}));

import { carregarGaleriaAdmin } from "./carga-galeria";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarGaleriaAdmin — admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregarGaleriaAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarImagensDaLojaAdmin).not.toHaveBeenCalled();
    expect(contarOriginaisDaLoja).not.toHaveBeenCalled();
    expect(buscarUsoDasImagens).not.toHaveBeenCalled();
  });
});

describe("carregarGaleriaAdmin — lojaId inválido", () => {
  it("recusa não-UUID via notFound() SEM provar admin nem ler dados", async () => {
    await expect(carregarGaleriaAdmin("nao-e-uuid")).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarImagensDaLojaAdmin).not.toHaveBeenCalled();
  });
});

describe("carregarGaleriaAdmin — sucesso: escopo e montagem", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarGaleriaAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("escopa grade, contagem e uso pelo lojaId validado, com o client de serviço", async () => {
    await carregarGaleriaAdmin(LOJA_ID);

    for (const fn of [listarImagensDaLojaAdmin, contarOriginaisDaLoja, buscarUsoDasImagens]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0]?.[0]).toBe(clientServico);
      expect(fn.mock.calls[0]?.[1]).toBe(LOJA_ID);
      expect(fn.mock.calls[0]?.[1]).not.toBe(OUTRA_LOJA);
    }
    // O uso é pedido só para as imagens da primeira página.
    expect(buscarUsoDasImagens.mock.calls[0]?.[2]).toEqual([IMG]);
  });

  it("devolve página, total e usos sem remapear", async () => {
    const r = await carregarGaleriaAdmin(LOJA_ID);

    expect(r.pagina).toBe(paginaFake);
    expect(r.total).toBe(37);
    expect(r.usos).toBe(usosFake);
  });

  it("falha da RPC de uso não derruba a página: segue sem selo", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    buscarUsoDasImagens.mockRejectedValueOnce(new Error("rpc caiu"));

    const r = await carregarGaleriaAdmin(LOJA_ID);

    expect(r.usos).toEqual([]);
    expect(r.pagina).toBe(paginaFake);
    erro.mockRestore();
  });

  it("falha da grade PROPAGA (não vira galeria vazia silenciosa)", async () => {
    listarImagensDaLojaAdmin.mockRejectedValueOnce(new Error("falha"));

    await expect(carregarGaleriaAdmin(LOJA_ID)).rejects.toThrow("falha");
  });
});
