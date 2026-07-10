import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 096 (crítica: SIM, TDD red-first).
 * Loader server-side `carregarLojaAdmin(lojaId)` em
 * `src/app/admin/assinantes/[lojaId]/carga.ts`. Chamado por Server Component
 * (admin SaaS). Após `verificarAdminSaaS()`, lê os dados da loja-alvo via
 * service_role ESCOPADOS por `lojaId`. `notFound()` quando a loja não existe.
 *
 * Por que é RED de verdade HOJE: o módulo alvo só expõe um STUB que lança
 * "TODO: GREEN". Nenhuma das invariantes abaixo pode passar antes da fase GREEN.
 *
 * Invariantes provadas (specs/admin-onboarding-assistido.md, issue 096):
 *  RN-1 (fail-closed, D-4): se `verificarAdminSaaS()` REJEITA, a exceção PROPAGA
 *    e NENHUMA leitura acontece — service client não é criado e NENHUMA query roda.
 *  notFound: `lojaId` inexistente (busca de loja → null) sinaliza `notFound()`
 *    (mockado para lançar — como o real do Next).
 *  Validação 083: `lojaId` inválido (não-UUID) é recusado SEM leitura de dados.
 *  RN-2/3 (escopo): sucesso retorna SÓ dados da `lojaId` pedida; TODA query
 *    recebe o `lojaId` validado (nenhum dado de outra loja).
 *
 * CONTRATO que o GREEN deve satisfazer
 *   (arquivo: src/app/admin/assinantes/[lojaId]/carga.ts):
 *     carregarLojaAdmin(lojaId: string): Promise<{
 *       loja, categorias, produtos, zonas, formasPagamento  // nomes a critério do GREEN
 *     }>
 *   Ordem obrigatória:
 *     1. validar lojaId (validarLojaIdAdmin / 083) — inválido → notFound()/recusa, sem leitura
 *     2. verificarAdminSaaS() ANTES de createServiceClient() (a falha PROPAGA)
 *     3. buscar loja por id; se null → notFound()
 *     4. demais queries com (svc, lojaId)
 *   Casos que precisam passar: os 4 testes abaixo.
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

// ── Queries: todas recebem (client, lojaId). Capturamos o lojaId recebido. ─────
// Loja-alvo em onboarding: `ativo: false` (a view vitrine_lojas a esconderia; o
// loader DEVE lê-la da TABELA base via `buscarLojaAdminPorId`).
const lojaFake = { id: LOJA_ID, nome: "Loja Alvo", ativo: false };
const buscarLojaAdminPorId = vi.fn(async (_c: unknown, _id: string) => lojaFake);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: (c: unknown, id: string) => buscarLojaAdminPorId(c, id),
}));

const categoriasFake = [{ id: "cat-1", loja_id: LOJA_ID }];
const buscarCategorias = vi.fn(async (_c: unknown, _id: string) => categoriasFake);
vi.mock("@/lib/supabase/queries/categorias", () => ({
  buscarCategorias: (c: unknown, id: string) => buscarCategorias(c, id),
}));

const produtosFake = [{ id: "prod-1", loja_id: LOJA_ID }];
const buscarProdutosDoLojista = vi.fn(async (_c: unknown, _id: string) => produtosFake);
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosDoLojista: (c: unknown, id: string) => buscarProdutosDoLojista(c, id),
}));

const zonasFake = [{ id: "zona-1", loja_id: LOJA_ID }];
const listarZonasComTaxas = vi.fn(async (_c: unknown, _id: string) => zonasFake);
const formasFake = [{ id: "forma-1", loja_id: LOJA_ID }];
const listarFormasPagamento = vi.fn(async (_c: unknown, _id: string) => formasFake);
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: (c: unknown, id: string) => listarZonasComTaxas(c, id),
  listarFormasPagamento: (c: unknown, id: string) => listarFormasPagamento(c, id),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()),
// que já existe. Garante que o loader recusa não-UUID via o helper canônico.

// Módulo alvo: hoje só um STUB que lança "TODO: GREEN" → RED por asserção.
import { carregarLojaAdmin, carregarLojaAdminBase } from "./carga";

const todasAsQueries = [
  buscarLojaAdminPorId,
  buscarCategorias,
  buscarProdutosDoLojista,
  listarZonasComTaxas,
  listarFormasPagamento,
];

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarLojaAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    const falhaAdmin = new Error("acesso negado");
    verificarAdminSaaS.mockRejectedValueOnce(falhaAdmin);

    await expect(carregarLojaAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    // Nenhuma elevação a service_role, nenhuma query.
    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarLojaAdmin — loja inexistente", () => {
  it("sinaliza notFound() quando a busca de loja retorna null", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce(null as never);

    await expect(carregarLojaAdmin(LOJA_ID)).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    // Admin foi provado antes de buscar.
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
  });
});

describe("carregarLojaAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID SEM ler dados (nem prova admin nem queries)", async () => {
    // Não asserta apenas `rejects.toThrow()` (o STUB lança incondicionalmente e
    // passaria de graça): exige que o erro NÃO seja o do STUB e que NADA tenha
    // sido lido — a recusa por validação acontece ANTES de qualquer leitura.
    await expect(carregarLojaAdmin("nao-e-uuid")).rejects.not.toThrow("TODO: GREEN");

    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
  });
});

describe("carregarLojaAdmin — sucesso: escopo RN-2/3", () => {
  it("prova admin ANTES de elevar service_role e ler", async () => {
    await carregarLojaAdmin(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("carrega a loja em onboarding (ativo=false) — NÃO vira notFound", async () => {
    // Regressão: ler da view vitrine_lojas (WHERE ativo=true) escondia a loja em
    // onboarding e o painel dava notFound() justo quando precisava configurá-la.
    // Com `buscarLojaAdminPorId` (TABELA base) a loja inativa É carregada.
    const resultado = (await carregarLojaAdmin(LOJA_ID)) as Record<string, unknown>;

    expect(notFound).not.toHaveBeenCalled();
    expect(Object.values(resultado)).toContainEqual(lojaFake);
    expect((lojaFake as { ativo: boolean }).ativo).toBe(false);
  });

  it("retorna objeto agregado com os dados da loja pedida", async () => {
    const resultado = (await carregarLojaAdmin(LOJA_ID)) as Record<string, unknown>;

    const valores = Object.values(resultado);
    expect(valores).toContainEqual(lojaFake);
    expect(valores).toContainEqual(categoriasFake);
    expect(valores).toContainEqual(produtosFake);
    expect(valores).toContainEqual(zonasFake);
    expect(valores).toContainEqual(formasFake);
  });

  it("TODA query é escopada pelo lojaId validado (nenhuma de outra loja)", async () => {
    await carregarLojaAdmin(LOJA_ID);

    for (const q of todasAsQueries) {
      expect(q).toHaveBeenCalledTimes(1);
      // segundo argumento = lojaId; nunca OUTRA_LOJA.
      const idRecebido = q.mock.calls[0]?.[1];
      expect(idRecebido).toBe(LOJA_ID);
      expect(idRecebido).not.toBe(OUTRA_LOJA);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// carregarLojaAdminBase (issue 150) — loader ENXUTO: SÓ a linha `lojas`.
// Mesma ordem fail-closed de carregarLojaAdmin, mas SEM over-fetch de
// categorias/produtos/zonas/formas (as sub-rotas Perfil/Horários/Tema/Assinatura).
// ═══════════════════════════════════════════════════════════════════════════════

// Queries de over-fetch que o loader base NÃO deve tocar (só as sub-rotas 152/153).
const queriesOverFetch = [
  buscarCategorias,
  buscarProdutosDoLojista,
  listarZonasComTaxas,
  listarFormasPagamento,
];

describe("carregarLojaAdminBase — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregarLojaAdminBase(LOJA_ID)).rejects.toThrow("acesso negado");

    // verificarAdminSaaS está FORA do try → a falha propaga sem elevar/ler.
    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarLojaAdminBase — lojaId inválido (083)", () => {
  it("recusa não-UUID com notFound() ANTES de qualquer leitura", async () => {
    await expect(carregarLojaAdminBase("nao-e-uuid")).rejects.toBeInstanceOf(NotFoundError);

    // notFound dispara antes de provar admin, elevar svc ou rodar query.
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
  });

  it("recusa string vazia com notFound() ANTES de qualquer leitura", async () => {
    await expect(carregarLojaAdminBase("")).rejects.toBeInstanceOf(NotFoundError);

    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    for (const q of todasAsQueries) {
      expect(q).not.toHaveBeenCalled();
    }
  });
});

describe("carregarLojaAdminBase — loja inexistente", () => {
  it("sinaliza notFound() quando buscarLojaAdminPorId retorna null", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce(null as never);

    await expect(carregarLojaAdminBase(LOJA_ID)).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
  });
});

describe("carregarLojaAdminBase — sucesso", () => {
  it("prova admin ANTES de elevar service_role e ler", async () => {
    await carregarLojaAdminBase(LOJA_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("retorna a linha `lojas` (loja em onboarding ativo=false INCLUSA)", async () => {
    const loja = await carregarLojaAdminBase(LOJA_ID);

    expect(notFound).not.toHaveBeenCalled();
    expect(loja).toBe(lojaFake);
    expect((loja as { ativo: boolean }).ativo).toBe(false);
  });

  it("busca a loja pelo lojaId VALIDADO, nunca OUTRA_LOJA", async () => {
    await carregarLojaAdminBase(LOJA_ID);

    expect(buscarLojaAdminPorId).toHaveBeenCalledTimes(1);
    const idRecebido = buscarLojaAdminPorId.mock.calls[0]?.[1];
    expect(idRecebido).toBe(LOJA_ID);
    expect(idRecebido).not.toBe(OUTRA_LOJA);
  });

  it("NÃO faz over-fetch: categorias/produtos/zonas/formas nunca são buscadas", async () => {
    await carregarLojaAdminBase(LOJA_ID);

    for (const q of queriesOverFetch) {
      expect(q).not.toHaveBeenCalled();
    }
  });
});
