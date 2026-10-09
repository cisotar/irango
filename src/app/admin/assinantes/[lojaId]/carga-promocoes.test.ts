import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * [362] Cobertura do loader `carregarPromocoesAdmin(lojaId)` — a elevação a
 * `service_role` da sub-rota admin de Avisos. Espelha `carga-galeria.test.ts`:
 * mocks de `verificarAdminSaaS`, `createServiceClient`, `next/navigation.notFound`
 * e das duas queries; `validarLojaIdAdmin` NÃO é mockado (implementação real,
 * z.guid()).
 *
 * Por que este arquivo existe: todo `carga-*.ts` tem irmão de teste, e aqui a
 * ORDEM é a trava que importa. O enforcement estático
 * (`enforcement-escopo-admin.test.ts`) prova que o guard EXISTE no módulo; só um
 * teste de comportamento prova que ele roda ANTES da elevação e que a rejeição
 * PROPAGA em vez de virar agregado vazio.
 *
 * Invariantes provadas:
 *  Validação: `lojaId` não-UUID → `notFound()` sem provar admin e sem ler nada
 *    (nem service client).
 *  Fail-closed: `verificarAdminSaaS()` rejeita → a exceção PROPAGA e nenhuma
 *    leitura acontece.
 *  Ordem: `verificarAdminSaaS()` antes de `createServiceClient()`.
 *  Escopo: as DUAS queries recebem o `lojaId` validado e o client de serviço —
 *    sob service_role (BYPASSRLS) esse argumento é a única barreira de tenant.
 *  Erro de leitura PROPAGA: nunca vira "loja sem avisos" silencioso (§14).
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

const modaisFake = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    loja_id: LOJA_ID,
    titulo: "Festa junina",
    mensagem: null,
    ativo: false,
    exibicao_inicio: "2026-06-01T00:00:00.000Z",
    exibicao_fim: "2026-06-30T00:00:00.000Z",
    mostrar_promocoes_junto: false,
    criado_em: "2026-05-01T00:00:00.000Z",
    atualizado_em: "2026-05-01T00:00:00.000Z",
    categorias: [],
    cardapios: [],
  },
];
const categoriasFake = [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", nome: "Lanches" }];

const listarModaisSazonaisDoDono = vi.fn(async (_c: unknown, _id: string) => modaisFake);
vi.mock("@/lib/supabase/queries/modaisSazonais", () => ({
  listarModaisSazonaisDoDono: (c: unknown, id: string) => listarModaisSazonaisDoDono(c, id),
}));

const buscarCategorias = vi.fn(async (_c: unknown, _id: string) => categoriasFake);
vi.mock("@/lib/supabase/queries/categorias", () => ({
  buscarCategorias: (c: unknown, id: string) => buscarCategorias(c, id),
}));

import { carregarPromocoesAdmin } from "./carga-promocoes";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarPromocoesAdmin — lojaId inválido", () => {
  it("recusa não-UUID via notFound() SEM provar admin nem elevar nem ler", async () => {
    await expect(carregarPromocoesAdmin("nao-e-uuid")).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarModaisSazonaisDoDono).not.toHaveBeenCalled();
    expect(buscarCategorias).not.toHaveBeenCalled();
  });
});

describe("carregarPromocoesAdmin — admin não provado", () => {
  it("propaga a exceção e NÃO eleva nem lê nada (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregarPromocoesAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarModaisSazonaisDoDono).not.toHaveBeenCalled();
    expect(buscarCategorias).not.toHaveBeenCalled();
  });
});

describe("carregarPromocoesAdmin — sucesso: ordem, escopo e montagem", () => {
  it("prova admin ANTES de elevar a service_role", async () => {
    await carregarPromocoesAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("escopa as DUAS leituras pelo lojaId validado, com o client de serviço", async () => {
    await carregarPromocoesAdmin(LOJA_ID);

    for (const fn of [listarModaisSazonaisDoDono, buscarCategorias]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0]?.[0]).toBe(clientServico);
      expect(fn.mock.calls[0]?.[1]).toBe(LOJA_ID);
      expect(fn.mock.calls[0]?.[1]).not.toBe(OUTRA_LOJA);
    }
  });

  it("devolve modais e categorias sem remapear", async () => {
    const r = await carregarPromocoesAdmin(LOJA_ID);

    expect(r.modais).toBe(modaisFake);
    expect(r.categorias).toBe(categoriasFake);
  });

  it("falha da leitura dos modais PROPAGA (não vira loja sem avisos)", async () => {
    listarModaisSazonaisDoDono.mockRejectedValueOnce(new Error("falha"));

    await expect(carregarPromocoesAdmin(LOJA_ID)).rejects.toThrow("falha");
  });

  it("falha da leitura das categorias PROPAGA (não vira editor sem checkbox)", async () => {
    buscarCategorias.mockRejectedValueOnce(new Error("falha"));

    await expect(carregarPromocoesAdmin(LOJA_ID)).rejects.toThrow("falha");
  });
});
