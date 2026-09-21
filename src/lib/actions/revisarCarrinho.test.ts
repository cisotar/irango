// TDD RED-first — issue 228 (crítica): `revisarCarrinhoAction`, o preview que
// deixa de receber dinheiro do cliente.
//
// Autoridade dos números: specs/desconto-por-produto-e-pratos-promocionais.md
//   D5 · D5-a · D5-b · D8 · D9 · RN-09-a · RN-10 · RN-10-a · RN-10-c · RN-10-d
//   (+ variação B) · RN-10-e · RN-11 · RN-12.
//
// O que este arquivo prova, e por que cada bloco existe:
//   1. os números de RN-10-a e RN-10-d saem do BANCO pela cadeia única
//      (buscarProdutosPorIds → precoEfetivo → derivarBasesCupom → calcularDesconto);
//   2. os três estados de RN-10-e chegam DECIDIDOS do servidor;
//   3. `produto_id`/`opcional_id` de outra loja são RECUSADOS (vetor IDOR);
//   4. `.strict()` rejeita qualquer campo monetário ANTES de qualquer I/O;
//   5. o teto de cardinalidade (MAX_ITENS_PEDIDO, CWE-770) vale aqui também;
//   6. o endpoint antigo (`validarCupom` + o `subtotal` do cliente) MORREU.
//
// A paridade numérica com `criarPedido` vive em
// `paridade-preview-autoritativo.test.ts` (é um teste de DUAS actions).
//
// Padrão de mocks: igual a pedido.test.ts — service.ts é
// `server-only`; cada query é um vi.fn() injetado por vi.mock. Nada de banco
// aqui: isto é ORQUESTRAÇÃO.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Tables } from "@/lib/database.types";
import { MAX_ITENS_PEDIDO } from "@/lib/constants/pedido";

vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

const fakeClient = { __fake: "service-client" };
const createServiceClient = vi.fn(() => fakeClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarProdutosPorIds = vi.fn();
const buscarOpcionaisPorIds = vi.fn();
const buscarOpcionaisPorCategoria = vi.fn();
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosPorIds: (...a: unknown[]) => buscarProdutosPorIds(...a),
  buscarOpcionaisPorIds: (...a: unknown[]) => buscarOpcionaisPorIds(...a),
  buscarOpcionaisPorCategoria: (...a: unknown[]) => buscarOpcionaisPorCategoria(...a),
}));

const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
}));

const buscarLojaParaPedido = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaParaPedido: (...a: unknown[]) => buscarLojaParaPedido(...a),
}));

// (249/252) A onda de leituras de `criarPedido`/`revisarCarrinhoAction` passou a
// incluir os cardápios da loja. Loja sem cardápio nenhum = o comportamento que
// estes testes já descreviam (todo produto é `visibilidade: 'menu'`).
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: async () => ({
    cardapios: [],
    vinculosPorProduto: new Map(),
  }),
}));

import * as rateLimitMod from "@/lib/utils/rateLimit";
import { revisarCarrinhoAction } from "./revisarCarrinho";

// ─────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const FEIJOADA = "aaaaaaaa-0000-0000-0000-000000000001"; // R$ 100,00 · −20%
const REFRI = "aaaaaaaa-0000-0000-0000-000000000002"; // R$ 50,00 · sem desconto
const PROD_B = "bbbbbbbb-0000-0000-0000-000000000001"; // produto da LOJA B
const OPC_BORDA = "ffffffff-0000-0000-0000-000000000001"; // R$ 10,00 · loja A
const OPC_B = "ffffffff-0000-0000-0000-0000000000b1"; // opcional da LOJA B
const CAT_PROD = "dddddddd-0000-0000-0000-000000000001"; // categoria do produto
const CAT_OPC = "eeeeeeee-0000-0000-0000-000000000001";

/** Loja ativa, com assinatura em dia — os gates de `pedido.ts:92-107`, que o
 *  preview passou a aplicar (auditoria 228/229 nº 2). */
function lojaRow(over: Record<string, unknown> = {}) {
  return {
    id: LOJA_A,
    nome: "Loja A",
    ativo: true,
    assinatura_status: "ativa",
    assinatura_fim_periodo: "2099-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Allowlist RN-O4: a categoria do produto autoriza a categoria do opcional. */
const ALLOWLIST = {
  [CAT_PROD]: [
    {
      categoriaOpcionalId: CAT_OPC,
      categoriaOpcionalNome: "Bordas",
      ordem: 0,
      opcionais: [],
    },
  ],
};

function produtoRow(over: Partial<Tables<"produtos">> = {}): Tables<"produtos"> {
  return {
    id: REFRI,
    loja_id: LOJA_A,
    // Com `categoria_id: null` o produto NÃO autoriza opcional nenhum (mesmo
    // gate de `pedido.ts:219`). O fixture padrão tem categoria para os casos de
    // RN-10-d exercitarem a allowlist de verdade, e não a divergência que a
    // auditoria fechou. Os NÚMEROS não mudam: RN-10-d segue R$ 6,00.
    categoria_id: CAT_PROD,
    nome: "Refrigerante",
    descricao: null,
    preco: 50.0,
    disponivel: true,
    oculto: false,
    ordem: 0,
    foto_url: null,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    // [244] coluna NOT NULL com default 'menu': é assim que toda linha nasce.
    visibilidade: "menu",
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Feijoada R$ 100,00 com −20% VIGENTE (sem prazo ⇒ vale até desligar, D1). */
function feijoadaComDesconto(over: Partial<Tables<"produtos">> = {}): Tables<"produtos"> {
  return produtoRow({
    id: FEIJOADA,
    nome: "Feijoada",
    preco: 100.0,
    desconto_ativo: true,
    desconto_tipo: "percentual",
    desconto_valor: 20,
    ...over,
  });
}

function opcionalRow(
  over: Partial<Tables<"opcionais">> = {},
): Pick<Tables<"opcionais">, "id" | "loja_id" | "categoria_opcional_id" | "nome" | "preco" | "ativo"> {
  return {
    id: OPC_BORDA,
    loja_id: LOJA_A,
    categoria_opcional_id: CAT_OPC,
    nome: "Borda recheada",
    preco: 10.0,
    ativo: true,
    ...over,
  };
}

function cupomRow(over: Partial<Tables<"cupons">> = {}): Tables<"cupons"> {
  return {
    id: "cccccccc-0000-0000-0000-000000000001",
    loja_id: LOJA_A,
    codigo: "PROMO10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 100.0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Carrinho de RN-10-a: Feijoada (−20%) ×1 + Refrigerante ×1. */
function carrinhoRN10a(over: Record<string, unknown> = {}) {
  return {
    loja_id: LOJA_A,
    codigo: "PROMO10",
    itens: [
      { produto_id: FEIJOADA, quantidade: 1 },
      { produto_id: REFRI, quantidade: 1 },
    ],
    ...over,
  };
}

/** Carrinho de RN-10-d: pizza promocional COM borda + refrigerante. */
function carrinhoRN10d(qtdPizza = 1) {
  return {
    loja_id: LOJA_A,
    codigo: "PROMO10",
    itens: [
      {
        produto_id: FEIJOADA,
        quantidade: qtdPizza,
        opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1 }],
      },
      { produto_id: REFRI, quantidade: 1 },
    ],
  };
}

function bancoRN10a() {
  buscarLojaParaPedido.mockResolvedValue(lojaRow());
  buscarProdutosPorIds.mockResolvedValue([feijoadaComDesconto(), produtoRow()]);
  buscarOpcionaisPorIds.mockResolvedValue([]);
  buscarOpcionaisPorCategoria.mockResolvedValue({});
  buscarCupomPorCodigo.mockResolvedValue(cupomRow());
}

function bancoRN10d() {
  buscarLojaParaPedido.mockResolvedValue(lojaRow());
  buscarProdutosPorIds.mockResolvedValue([feijoadaComDesconto(), produtoRow()]);
  buscarOpcionaisPorIds.mockResolvedValue([opcionalRow()]);
  buscarOpcionaisPorCategoria.mockResolvedValue(ALLOWLIST);
  buscarCupomPorCodigo.mockResolvedValue(cupomRow());
}

/** Estreita o retorno para o ramo de sucesso — `ok:false` falha o teste aqui,
 *  em vez de produzir um `undefined` silencioso três linhas abaixo. */
function ok(r: Awaited<ReturnType<typeof revisarCarrinhoAction>>) {
  if (!r.ok) throw new Error(`esperava ok:true, veio ok:false (${r.mensagem})`);
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimitMod.verificarRateLimit).mockResolvedValue({
    permitido: true,
  } as Awaited<ReturnType<typeof rateLimitMod.verificarRateLimit>>);
  // Loja saudável por padrão: cada teste que exercita o gate de loja sobrescreve.
  buscarLojaParaPedido.mockResolvedValue(lojaRow());
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[228] revisarCarrinhoAction — os números saem do BANCO (RN-09-a, RN-10-e)", () => {
  it("RN-10-a: subtotal 130,00 · base elegível 50,00 · desconto 5,00 · economia 20,00", async () => {
    bancoRN10a();
    const r = ok(await revisarCarrinhoAction(carrinhoRN10a()));

    // Os preços já com desconto de produto (D8): 80,00 + 50,00.
    expect(r.subtotal).toBe(130);
    // Σ (preco − precoEfetivo) × qtd — pronto do servidor, nunca do cliente.
    expect(r.economiaProdutos).toBe(20);
    expect(r.cupom).toEqual({
      valido: true,
      estadoCupom: {
        estado: "parcial", // 0 < 50 < 130
        codigo: "PROMO10",
        // NÃO é 13,00 (10% de 130 — ignoraria a promoção), e o cupom NÃO é
        // recusado por 50 < 100: a régua do mínimo é o SUBTOTAL (D5-a).
        desconto: 5,
        baseElegivel: 50,
        baseProdutos: 50,
        baseOpcionais: 0,
      },
    });
  });

  it("RN-10-d: borda em linha promocional ENTRA na base — desconto 6,00, não 5,00 nem 14,00", async () => {
    bancoRN10d();
    const r = ok(await revisarCarrinhoAction(carrinhoRN10d()));

    expect(r.subtotal).toBe(140); // (80 + 10) + 50
    expect(r.cupom).toEqual({
      valido: true,
      estadoCupom: {
        estado: "parcial",
        codigo: "PROMO10",
        // 10% de 60,00. R$ 5,00 seria a regra "por linha" que D9 reverteu;
        // R$ 14,00 seria ignorar a promoção inteira.
        desconto: 6,
        baseElegivel: 60,
        baseProdutos: 50,
        baseOpcionais: 10,
      },
    });
  });

  it("RN-10-d variação B: com 2 pizzas o opcional soma UMA vez por linha (base 60, não 70)", async () => {
    bancoRN10d();
    const r = ok(await revisarCarrinhoAction(carrinhoRN10d(2)));

    expect(r.subtotal).toBe(220); // (80×2 + 10) + 50
    expect(r.economiaProdutos).toBe(40); // (100 − 80) × 2
    expect(r.cupom).toMatchObject({
      valido: true,
      estadoCupom: {
        // baseOpcionais 20 (× qtd DO PRODUTO) inflaria a base para 70 e o
        // desconto para 7,00 — prejuízo do lojista (RN-09-a, armadilha do × qtd).
        baseOpcionais: 10,
        baseElegivel: 60,
        desconto: 6,
      },
    });
  });

  it("RN-10-c (estado C): carrinho 100% promocional e SEM adicional ⇒ estado 'zero', sem desconto", async () => {
    buscarProdutosPorIds.mockResolvedValue([feijoadaComDesconto()]);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    const r = ok(
      await revisarCarrinhoAction({
        loja_id: LOJA_A,
        codigo: "PROMO10",
        itens: [{ produto_id: FEIJOADA, quantidade: 1 }],
      }),
    );

    expect(r.subtotal).toBe(80);
    expect(r.economiaProdutos).toBe(20);
    // O cupom é ACEITO (RN-10.1) e o estado NÃO carrega `desconto`: não existe
    // linha "Desconto R$ 0,00" para a UI renderizar por engano (RN-10.2).
    expect(r.cupom).toEqual({
      valido: true,
      estadoCupom: { estado: "zero", codigo: "PROMO10" },
    });
  });

  it("RN-10-e (estado A): nada em promoção ⇒ baseElegivel === subtotal, estado 'cheio', sem parcelas", async () => {
    buscarProdutosPorIds.mockResolvedValue([
      produtoRow({ id: FEIJOADA, nome: "Feijoada", preco: 100 }),
      produtoRow(),
    ]);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());

    const r = ok(await revisarCarrinhoAction(carrinhoRN10a()));

    expect(r.subtotal).toBe(150);
    expect(r.economiaProdutos).toBe(0);
    // Estado A não tem frase a explicar ⇒ não devolve base nenhuma para a UI
    // ter o que comparar no browser (RN-10-e / D5-b).
    expect(r.cupom).toEqual({
      valido: true,
      estadoCupom: { estado: "cheio", codigo: "PROMO10", desconto: 15 },
    });
  });

  it("D5-a: a régua do pedido mínimo é o SUBTOTAL — recusa é `valido:false`, não um quarto estado", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 100 }));

    const r = ok(
      await revisarCarrinhoAction({
        loja_id: LOJA_A,
        codigo: "PROMO10",
        itens: [{ produto_id: REFRI, quantidade: 1 }], // subtotal 50 < 100
      }),
    );

    expect(r.subtotal).toBe(50);
    expect(r.cupom).toMatchObject({ valido: false });
    // O motivo pedido_minimo é REVELÁVEL (o cliente precisa saber quanto falta);
    // fragmento afirmado para a mensagem não degradar para o genérico.
    expect((r.cupom as { mensagem: string }).mensagem).toContain("Pedido mínimo");
  });

  it("RN-12: devolve os preços do banco NAQUELE instante (tabela e efetivo, por linha)", async () => {
    bancoRN10a();
    const r = ok(await revisarCarrinhoAction(carrinhoRN10a()));

    expect(r.itens).toEqual([
      // (252) `compravel`/`motivoNaoCompravel` viajam em TODA linha: produto do
      // menu, sem cardápio nenhum, é comprável sem motivo a declarar.
      {
        produto_id: FEIJOADA,
        quantidade: 1,
        preco: 100,
        precoEfetivo: 80,
        temDesconto: true,
        compravel: true,
        motivoNaoCompravel: null,
      },
      {
        produto_id: REFRI,
        quantidade: 1,
        preco: 50,
        precoEfetivo: 50,
        temDesconto: false,
        compravel: true,
        motivoNaoCompravel: null,
      },
    ]);
  });

  it("sem código de cupom ⇒ revisa o carrinho mesmo assim, com `cupom: null`", async () => {
    bancoRN10a();
    const r = ok(
      await revisarCarrinhoAction({
        loja_id: LOJA_A,
        itens: [
          { produto_id: FEIJOADA, quantidade: 1 },
          { produto_id: REFRI, quantidade: 1 },
        ],
      }),
    );

    expect(r.subtotal).toBe(130);
    expect(r.cupom).toBeNull();
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[228] revisarCarrinhoAction — IDOR / cross-loja (o preview recebe IDS do cliente)", () => {
  it("produto_id de OUTRA loja é recusado, e a mensagem não vaza nada sobre ele", async () => {
    buscarProdutosPorIds.mockResolvedValue([
      produtoRow({ id: PROD_B, loja_id: LOJA_B, nome: "Segredo da Loja B", preco: 999 }),
    ]);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [{ produto_id: PROD_B, quantidade: 1 }],
    });

    expect(r.ok).toBe(false);
    // FRAGMENTO afirmado: sem ele, um `ok:false` por qualquer outro motivo
    // (schema, I/O) passaria por "recusou cross-loja" sem recusar nada.
    expect((r as { mensagem: string }).mensagem).toContain("Não foi possível revisar o carrinho");
    // Nada do tenant vizinho atravessa a fronteira: nem id, nem nome, nem preço.
    expect((r as { mensagem: string }).mensagem).not.toContain(PROD_B);
    expect((r as { mensagem: string }).mensagem).not.toContain("Segredo da Loja B");
    expect((r as { mensagem: string }).mensagem).not.toContain("999");
  });

  it("opcional_id de OUTRA loja é recusado (o preço do adicional entra na base elegível — D9)", async () => {
    buscarProdutosPorIds.mockResolvedValue([feijoadaComDesconto()]);
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ id: OPC_B, loja_id: LOJA_B, nome: "Adicional da Loja B", preco: 500 }),
    ]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [
        { produto_id: FEIJOADA, quantidade: 1, opcionais: [{ opcional_id: OPC_B, quantidade: 1 }] },
      ],
    });

    expect(r.ok).toBe(false);
    expect((r as { mensagem: string }).mensagem).toContain("Não foi possível revisar o carrinho");
    expect((r as { mensagem: string }).mensagem).not.toContain("Adicional da Loja B");
  });

  it("opcional INATIVO é recusado (mesmo gate do autoritativo, RN-O5)", async () => {
    buscarProdutosPorIds.mockResolvedValue([feijoadaComDesconto()]);
    buscarOpcionaisPorIds.mockResolvedValue([opcionalRow({ ativo: false })]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [
        { produto_id: FEIJOADA, quantidade: 1, opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1 }] },
      ],
    });

    expect(r.ok).toBe(false);
  });

  it("produto OCULTO e produto INDISPONÍVEL são recusados — o preview lê a TABELA, não a vitrine", async () => {
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    buscarProdutosPorIds.mockResolvedValue([produtoRow({ oculto: true })]);
    const oculto = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [{ produto_id: REFRI, quantidade: 1 }],
    });
    expect(oculto.ok).toBe(false);

    buscarProdutosPorIds.mockResolvedValue([produtoRow({ disponivel: false })]);
    const esgotado = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [{ produto_id: REFRI, quantidade: 1 }],
    });
    expect(esgotado.ok).toBe(false);
  });

  it("cupom de outra loja / inexistente / inativo ⇒ MESMA mensagem genérica (anti-enumeração §6)", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});

    buscarCupomPorCodigo.mockResolvedValue(null); // não casa (loja_id, codigo)
    const inexistente = ok(
      await revisarCarrinhoAction({
        loja_id: LOJA_A,
        codigo: "SECRETOB",
        itens: [{ produto_id: REFRI, quantidade: 1 }],
      }),
    );

    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ ativo: false, pedido_minimo: 0 }));
    const inativo = ok(
      await revisarCarrinhoAction({
        loja_id: LOJA_A,
        codigo: "PROMO10",
        itens: [{ produto_id: REFRI, quantidade: 1 }],
      }),
    );

    expect(inexistente.cupom).toMatchObject({ valido: false });
    // Byte a byte: qualquer diferença entre os dois vira oráculo de existência.
    expect(inexistente.cupom).toEqual(inativo.cupom);
    // E o carrinho continua sendo revisado — cupom ruim não derruba a tela.
    expect(inexistente.subtotal).toBe(50);
  });

  it("a busca do cupom é SEMPRE escopada por (loja_id, codigo)", async () => {
    bancoRN10a();
    await revisarCarrinhoAction(carrinhoRN10a());
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(
      expect.anything(),
      LOJA_A,
      "PROMO10",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[228] revisarCarrinhoAction — `.strict()` e teto de cardinalidade (CWE-770)", () => {
  /** Nenhuma leitura pode ter acontecido: o zod barra ANTES de qualquer I/O. */
  function nenhumIO() {
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
    expect(buscarOpcionaisPorIds).not.toHaveBeenCalled();
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  }

  it.each([
    ["subtotal", { subtotal: 0.01 }],
    ["subtotal_preview", { subtotal_preview: 999 }],
    ["baseElegivel", { baseElegivel: 100000 }],
    ["desconto", { desconto: 999 }],
    ["total", { total: 0.01 }],
  ])("campo monetário `%s` na raiz é REJEITADO antes de qualquer I/O", async (_nome, extra) => {
    bancoRN10a();
    const r = await revisarCarrinhoAction(carrinhoRN10a(extra));
    expect(r.ok).toBe(false);
    nenhumIO();
  });

  it.each([
    ["preco", { preco: 0.01 }],
    ["precoEfetivo", { precoEfetivo: 0.01 }],
    ["temDesconto", { temDesconto: false }],
  ])("campo `%s` DENTRO do item é REJEITADO — o cliente não diz preço nem quem está em promoção", async (_nome, extra) => {
    bancoRN10a();
    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [{ produto_id: FEIJOADA, quantidade: 1, ...extra }],
    });
    expect(r.ok).toBe(false);
    nenhumIO();
  });

  it("campo monetário DENTRO do opcional é REJEITADO (RN-O2)", async () => {
    bancoRN10d();
    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [
        {
          produto_id: FEIJOADA,
          quantidade: 1,
          opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1, preco: 0 }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    nenhumIO();
  });

  it(`acima de MAX_ITENS_PEDIDO (${MAX_ITENS_PEDIDO}) é rejeitado antes de qualquer I/O`, async () => {
    bancoRN10a();
    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: Array.from({ length: MAX_ITENS_PEDIDO + 1 }, () => ({
        produto_id: REFRI,
        quantidade: 1,
      })),
    });
    expect(r.ok).toBe(false);
    nenhumIO();
  });

  it("exatamente MAX_ITENS_PEDIDO passa — o teto é o mesmo de pedido.ts, nem mais apertado", async () => {
    bancoRN10a();
    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: Array.from({ length: MAX_ITENS_PEDIDO }, () => ({
        produto_id: REFRI,
        quantidade: 1,
      })),
    });
    expect(r.ok).toBe(true);
  });

  it("loja_id que não é uuid e quantidade fora de 1..99 são rejeitados sem I/O", async () => {
    bancoRN10a();
    expect((await revisarCarrinhoAction(carrinhoRN10a({ loja_id: "nao-uuid" }))).ok).toBe(false);
    expect(
      (
        await revisarCarrinhoAction({
          loja_id: LOJA_A,
          itens: [{ produto_id: REFRI, quantidade: 0 }],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await revisarCarrinhoAction({
          loja_id: LOJA_A,
          itens: [{ produto_id: REFRI, quantidade: 100 }],
        })
      ).ok,
    ).toBe(false);
    nenhumIO();
  });

  it("carrinho vazio é rejeitado (`.min(1)`, como em pedido.ts)", async () => {
    bancoRN10a();
    const r = await revisarCarrinhoAction({ loja_id: LOJA_A, itens: [] });
    expect(r.ok).toBe(false);
    nenhumIO();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("[228] revisarCarrinhoAction — rate limit e erro interno", () => {
  it("rate limit bloqueado ⇒ recusa, em BALDE PRÓPRIO (não o do cupom)", async () => {
    bancoRN10a();
    vi.mocked(rateLimitMod.verificarRateLimit).mockResolvedValue({
      permitido: false,
    } as Awaited<ReturnType<typeof rateLimitMod.verificarRateLimit>>);

    const r = await revisarCarrinhoAction(carrinhoRN10a());

    expect(r.ok).toBe(false);
    // Achado do `auditar`: compartilhar o balde de `validarCupom` fazia a
    // revisão automática esgotar a cota e sumir com um cupom VÁLIDO do resumo.
    expect(rateLimitMod.verificarRateLimit).toHaveBeenCalledWith(
      "revisarCarrinho",
      "203.0.113.7",
    );
    expect(rateLimitMod.verificarRateLimit).not.toHaveBeenCalledWith(
      "validarCupom",
      expect.anything(),
    );
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
  });

  it("erro interno não vaza: log no servidor, mensagem genérica ao cliente (§14)", async () => {
    const erro = new Error("connection terminated: host=db.internal user=postgres");
    buscarProdutosPorIds.mockRejectedValue(erro);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await revisarCarrinhoAction(carrinhoRN10a());

    expect(r.ok).toBe(false);
    expect((r as { mensagem: string }).mensagem).not.toContain("db.internal");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Correções da auditoria 228/229 — paridade de gates com `pedido.ts`.
describe("[auditoria 228/229] o preview aplica os MESMOS gates do autoritativo", () => {
  it("produto SEM categoria não autoriza opcional nenhum (RN-O4, paridade com pedido.ts:219)", async () => {
    // O cenário exato da prova do auditor: produto R$ 50,00 sem categoria e
    // opcional R$ 10,00 ATIVO, da MESMA loja, fora de qualquer allowlist.
    // Antes: preview dizia `ok:true` com subtotal 60 e o pedido recusava.
    buscarProdutosPorIds.mockResolvedValue([produtoRow({ categoria_id: null })]);
    buscarOpcionaisPorIds.mockResolvedValue([opcionalRow()]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      itens: [
        { produto_id: REFRI, quantidade: 1, opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1 }] },
      ],
    });

    expect(r.ok).toBe(false);
    expect((r as { mensagem: string }).mensagem).toContain("Não foi possível revisar o carrinho");
  });

  it("opcional de categoria NÃO associada ao produto é recusado, mesmo com o produto categorizado", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ categoria_opcional_id: "eeeeeeee-0000-0000-0000-0000000000ff" }),
    ]);
    buscarOpcionaisPorCategoria.mockResolvedValue(ALLOWLIST);
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 0 }));

    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      itens: [
        { produto_id: REFRI, quantidade: 1, opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1 }] },
      ],
    });

    expect(r.ok).toBe(false);
  });

  it("loja INATIVA ⇒ recusa genérica, sem revelar preço nem promoção (paridade pedido.ts:93)", async () => {
    bancoRN10a();
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ ativo: false }));

    const r = await revisarCarrinhoAction(carrinhoRN10a());

    expect(r.ok).toBe(false);
    expect((r as { mensagem: string }).mensagem).toContain("Não foi possível revisar o carrinho");
    expect((r as { mensagem: string }).mensagem).not.toContain("80");
  });

  it("assinatura BLOQUEADA ⇒ recusa genérica (paridade pedido.ts:96-104)", async () => {
    bancoRN10a();
    buscarLojaParaPedido.mockResolvedValue(
      lojaRow({ assinatura_status: "bloqueada", assinatura_fim_periodo: "2020-01-01T00:00:00.000Z" }),
    );

    const r = await revisarCarrinhoAction(carrinhoRN10a());

    expect(r.ok).toBe(false);
  });

  it("loja INEXISTENTE ⇒ recusa genérica", async () => {
    bancoRN10a();
    buscarLojaParaPedido.mockResolvedValue(null);

    expect((await revisarCarrinhoAction(carrinhoRN10a())).ok).toBe(false);
  });

  it("loja FECHADA no horário NÃO derruba a revisão — horário não é segredo (UX legítima)", async () => {
    // `lojaAberta` é a única diferença deliberada: o preview não a aplica, e por
    // isso `lojaRow()` nem precisa de `horarios`/`timezone`.
    bancoRN10a();
    const r = ok(await revisarCarrinhoAction(carrinhoRN10a()));
    expect(r.subtotal).toBe(130);
  });

  it("código de cupom com menos de 3 caracteres é rejeitado no preview, como em `criarPedido`", async () => {
    bancoRN10a();
    const r = await revisarCarrinhoAction(carrinhoRN10a({ codigo: "AB" }));
    expect(r.ok).toBe(false);
    // Régua única `codigoCupomSchema`: o preview não pode aceitar um código que
    // o autoritativo derruba com erro genérico (beco sem saída).
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("código de cupom acima de 20 caracteres nem chega ao `.eq(\"codigo\", …)`", async () => {
    bancoRN10a();
    const r = await revisarCarrinhoAction(carrinhoRN10a({ codigo: "A".repeat(2000) }));
    expect(r.ok).toBe(false);
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cobertura reposta: os casos de cupom EXPIRADO e ESGOTADO vinham do
// `cupomPreview.test.ts`, apagado com o endpoint antigo.
describe("[228] cupom expirado e esgotado ⇒ mesma recusa genérica do inexistente", () => {
  function carrinhoSimples() {
    return {
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: [{ produto_id: REFRI, quantidade: 1 }],
    };
  }

  async function veredito(cupom: Tables<"cupons"> | null) {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    buscarCupomPorCodigo.mockResolvedValue(cupom);
    return ok(await revisarCarrinhoAction(carrinhoSimples()));
  }

  it("cupom EXPIRADO: `valido:false` e o carrinho continua revisado", async () => {
    const r = await veredito(
      cupomRow({ pedido_minimo: 0, expira_em: "2020-01-01T00:00:00.000Z" }),
    );

    expect(r.cupom).toMatchObject({ valido: false });
    expect((r.cupom as { mensagem: string }).mensagem).toBe("Cupom inválido ou não encontrado.");
    expect(r.subtotal).toBe(50);
  });

  it("cupom ESGOTADO (usos_contagem >= usos_maximos): `valido:false`, mesma string", async () => {
    const r = await veredito(
      cupomRow({ pedido_minimo: 0, usos_maximos: 5, usos_contagem: 5 }),
    );

    expect(r.cupom).toMatchObject({ valido: false });
    expect((r.cupom as { mensagem: string }).mensagem).toBe("Cupom inválido ou não encontrado.");
    expect(r.subtotal).toBe(50);
  });

  it("expirado, esgotado e inexistente são INDISTINGUÍVEIS byte a byte (§6)", async () => {
    const expirado = await veredito(
      cupomRow({ pedido_minimo: 0, expira_em: "2020-01-01T00:00:00.000Z" }),
    );
    const esgotado = await veredito(
      cupomRow({ pedido_minimo: 0, usos_maximos: 1, usos_contagem: 1 }),
    );
    const inexistente = await veredito(null);

    expect(expirado.cupom).toEqual(esgotado.cupom);
    expect(expirado.cupom).toEqual(inexistente.cupom);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O endpoint antigo MORRE nesta issue (RN-11, 🔴 do escopo): não basta perder o
// caller — função exportada de arquivo `'use server'` é endpoint RPC VIVO.
// Este bloco é a trava mecânica do critério de aceite
//   `grep -rn "subtotal_preview|validarCupomAction" src/` → vazio.
// Os termos são montados por concatenação para o próprio arquivo não casar.
describe("[228] o oráculo antigo não existe mais em src/", () => {
  const RAIZ = new URL("../../", import.meta.url).pathname; // src/
  const PROIBIDOS = ["subtotal" + "_preview", "validarCupom" + "Action"];

  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nome) => {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) return arquivos(caminho);
      return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
    });
  }

  it.each(PROIBIDOS)("`%s` não aparece em nenhum arquivo de src/", (termo) => {
    const culpados = arquivos(RAIZ).filter(
      (f) => !f.endsWith("revisarCarrinho.test.ts") && readFileSync(f, "utf8").includes(termo),
    );
    expect(culpados).toEqual([]);
  });

  it("`validarCupom` deixou de ser exportada de cupom.ts — a porta RPC está fechada", () => {
    const cupom = readFileSync(join(RAIZ, "lib/actions/cupom.ts"), "utf8");
    expect(cupom).not.toMatch(/export\s+async\s+function\s+validarCupom\s*\(/);
  });
});
