import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura pós-GREEN da issue 269 (fase 5) — loader
 * `carregarCardapioDetalheAdmin(lojaId, cardapioId)` em
 * `src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.ts`, o gêmeo admin
 * de `/painel/cardapios/[cardapioId]`. Zero teste dedicado até agora — espelha
 * o padrão de `carga-opcionais.test.ts` / `carga.test.ts`.
 *
 * Invariantes provadas:
 *  - `lojaId` não-UUID → `notFound()` ANTES de qualquer leitura;
 *  - `verificarAdminSaaS()` REJEITA → PROPAGA, nenhuma leitura corre;
 *  - `verificarAdminSaaS()` roda ANTES de `createServiceClient()`;
 *  - loja-alvo inexistente (`buscarLojaAdminPorId` → null) ⇒ `notFound()`,
 *    SEM chegar a `buscarCardapioPorId`;
 *  - **cardápio de OUTRA loja** (`buscarCardapioPorId` → null, porque a query
 *    tem `.eq("loja_id", lojaId)` explícito) ⇒ `notFound()` — a MESMA resposta
 *    de cardápio inexistente, byte a byte (sem oráculo de existência,
 *    `seguranca.md` §14);
 *  - as três leituras finais (produtos/categorias/cardápios-com-produtos) só
 *    rodam DEPOIS de loja E cardápio confirmados, e escopadas pelo `lojaId`
 *    validado.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const CARDAPIO_ID = "33333333-3333-3333-3333-333333333333";

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

const cardapioFake = { id: CARDAPIO_ID, nome: "Feijoada", modo: "recorrente" };
const buscarCardapioPorId = vi.fn(async (_c: unknown, _lojaId: string, _id: string) => cardapioFake);
const cardapiosComProdutosFake = {
  cardapios: [{ id: CARDAPIO_ID, loja_id: LOJA_ID }],
  vinculosPorProduto: new Map([
    ["prod-1", [{ cardapio: { id: CARDAPIO_ID }, dias_semana: null }]],
    // [276] Um vínculo COM agenda: o mundo admin precisa dos mesmos dias que o
    // do lojista para derivar a frase e o aviso de RN-06 no servidor.
    ["prod-2", [{ cardapio: { id: CARDAPIO_ID }, dias_semana: [3, 6] }]],
  ]),
};
const buscarCardapiosComProdutos = vi.fn(async (_c: unknown, _id: string) => cardapiosComProdutosFake);
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapioPorId: (c: unknown, lojaId: string, id: string) =>
    buscarCardapioPorId(c, lojaId, id),
  buscarCardapiosComProdutos: (c: unknown, id: string) => buscarCardapiosComProdutos(c, id),
}));

const produtosFake = [{ id: "prod-1", loja_id: LOJA_ID }];
const buscarProdutosDoLojista = vi.fn(async (_c: unknown, _id: string) => produtosFake);
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosDoLojista: (c: unknown, id: string) => buscarProdutosDoLojista(c, id),
}));

const categoriasFake = [{ id: "cat-1", loja_id: LOJA_ID }];
const buscarCategorias = vi.fn(async (_c: unknown, _id: string) => categoriasFake);
vi.mock("@/lib/supabase/queries/categorias", () => ({
  buscarCategorias: (c: unknown, id: string) => buscarCategorias(c, id),
}));

const lojaFake = { id: LOJA_ID, nome: "Loja Alvo", timezone: "America/Sao_Paulo" };
const buscarLojaAdminPorId = vi.fn(async (_c: unknown, _id: string) => lojaFake);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: (c: unknown, id: string) => buscarLojaAdminPorId(c, id),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()).

import { carregarCardapioDetalheAdmin } from "./carga-cardapio-detalhe";

const todasAsLeiturasFinais = [buscarProdutosDoLojista, buscarCategorias, buscarCardapiosComProdutos];

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
  buscarLojaAdminPorId.mockResolvedValue(lojaFake);
  buscarCardapioPorId.mockResolvedValue(cardapioFake);
  buscarProdutosDoLojista.mockResolvedValue(produtosFake);
  buscarCategorias.mockResolvedValue(categoriasFake);
  buscarCardapiosComProdutos.mockResolvedValue(cardapiosComProdutosFake);
});

describe("carregarCardapioDetalheAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID)).rejects.toThrow(
      "acesso negado",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(buscarCardapioPorId).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarCardapioDetalheAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() ANTES de provar admin ou ler", async () => {
    await expect(
      carregarCardapioDetalheAdmin("nao-e-uuid", CARDAPIO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(buscarCardapioPorId).not.toHaveBeenCalled();
  });
});

describe("carregarCardapioDetalheAdmin — loja-alvo inexistente", () => {
  it("buscarLojaAdminPorId → null ⇒ notFound(), SEM chegar a buscarCardapioPorId", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce(null as never);

    await expect(
      carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(buscarCardapioPorId).not.toHaveBeenCalled();
    for (const q of todasAsLeiturasFinais) expect(q).not.toHaveBeenCalled();
  });
});

describe("carregarCardapioDetalheAdmin — cardápio inexistente OU de OUTRA loja", () => {
  it("buscarCardapioPorId → null ⇒ notFound(), SEM ler produtos/categorias/cardapiosComProdutos", async () => {
    buscarCardapioPorId.mockResolvedValueOnce(null as never);

    await expect(
      carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    for (const q of todasAsLeiturasFinais) expect(q).not.toHaveBeenCalled();
  });

  // Sem oráculo de existência: um cardápio de OUTRA loja não é distinguível de
  // um cardápio que nunca existiu, porque as duas situações caem no MESMO
  // `buscarCardapioPorId(svc, lojaId, cardapioId) === null` (a query já tem
  // `.eq("loja_id", lojaId)` embutido) — não há um segundo ramo de código que
  // um atacante possa sondar por diferença de latência/mensagem.
  it("cardápio de OUTRA loja e cardápio inexistente caem no MESMO ramo: ambos notFound()", async () => {
    buscarCardapioPorId.mockResolvedValueOnce(null as never); // simula "de outra loja"
    const erroOutraLoja = await carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID).catch(
      (e) => e,
    );

    vi.clearAllMocks();
    buscarLojaAdminPorId.mockResolvedValue(lojaFake);
    buscarCardapioPorId.mockResolvedValueOnce(null as never); // simula "nunca existiu"
    const erroInexistente = await carregarCardapioDetalheAdmin(
      LOJA_ID,
      "99999999-9999-9999-9999-999999999999",
    ).catch((e) => e);

    expect(erroOutraLoja).toBeInstanceOf(NotFoundError);
    expect(erroInexistente).toBeInstanceOf(NotFoundError);
  });

  it("a query de cardápio recebe o lojaId VALIDADO — nunca OUTRA_LOJA nem o cardapioId sozinho", async () => {
    await carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID).catch(() => {});

    expect(buscarCardapioPorId).toHaveBeenCalledWith(expect.anything(), LOJA_ID, CARDAPIO_ID);
    expect(buscarCardapioPorId).not.toHaveBeenCalledWith(
      expect.anything(),
      OUTRA_LOJA,
      CARDAPIO_ID,
    );
  });
});

describe("carregarCardapioDetalheAdmin — sucesso: ordem, escopo e agregado", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("as três leituras finais recebem o lojaId VALIDADO, nunca OUTRA_LOJA", async () => {
    await carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID);

    for (const q of todasAsLeiturasFinais) {
      expect(q).toHaveBeenCalledTimes(1);
      const idRecebido = q.mock.calls[0]?.[1];
      expect(idRecebido).toBe(LOJA_ID);
      expect(idRecebido).not.toBe(OUTRA_LOJA);
    }
  });

  it("retorna o agregado com os cinco campos das queries mockadas", async () => {
    const resultado = await carregarCardapioDetalheAdmin(LOJA_ID, CARDAPIO_ID);

    expect(resultado).toEqual({
      loja: lojaFake,
      cardapio: cardapioFake,
      produtos: produtosFake,
      categorias: categoriasFake,
      vinculosPorProduto: cardapiosComProdutosFake.vinculosPorProduto,
    });
  });

  /**
   * [276] A carga NÃO muda nesta issue — `COLUNAS_CARDAPIO_VIGENCIA` já traz
   * `dias_semana` por vínculo desde [273]. Esta asserção é a trava de que ele
   * sobrevive à carga: sem ele, a página admin derivaria `null` em toda linha
   * e renderizaria mudo, sem quebrar nada.
   */
  it("o dias_semana de cada vínculo sobrevive à carga, sem query nova", async () => {
    const { vinculosPorProduto } = await carregarCardapioDetalheAdmin(
      LOJA_ID,
      CARDAPIO_ID,
    );
    expect(vinculosPorProduto.get("prod-2")?.[0].dias_semana).toEqual([3, 6]);
    expect(vinculosPorProduto.get("prod-1")?.[0].dias_semana).toBeNull();
    expect(buscarCardapiosComProdutos).toHaveBeenCalledTimes(1);
  });
});
