import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) — spec `specs/modalidades-entrega-loja.md`, fatia B (checkout
 * autoritativo). Arquivo NOVO: `pedido.test.ts` não é editado.
 *
 * A autoridade é o servidor (mandato 1): `criarPedido` relê `aceita_retirada`,
 * `aceita_entrega` e `modo_frete` da LOJA (`buscarLojaParaPedido`, que já faz
 * `select *`) a cada submit. Nada disso vem do payload.
 *
 * Casos da tabela "Risco por fatia" (plano, fatia B):
 *  (1) `tipo_entrega` desligado na loja → `{ erro }` e a RPC NÃO é chamada
 *      (carrinho aberto antes do lojista mudar a configuração);
 *  (2) modo a combinar, subtotal 50, cupom 10% → RPC com `p_taxa_entrega: null`,
 *      `p_frete_a_combinar: true`, `p_total: 45`;
 *  (3) modo a combinar com subtotal ACIMA de `pedido_minimo_gratis` → continua
 *      `p_frete_a_combinar: true` (nunca taxa 0 = "grátis");
 *  (4) modo a combinar → `distanciaDaLojaAoCep` e ViaCEP (`resolverCepServidor`)
 *      NÃO chamados; endereço gravado;
 *  (5) automático, fora de zona, sem `taxa_entrega_fora_zona` → `{ erro }`, RPC
 *      não chamada (TRAVA DE REGRESSÃO: já é verdade hoje em pedido.ts; fica
 *      aqui para o GREEN não afrouxar o modo automático ao mexer no ramo).
 *
 * Mocks: mesmo padrão de `pedido.test.ts` (I/O mockado, RPC via `fakeClient.rpc`).
 */

vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

const fakeClient = { __fake: "service-client", rpc: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeClient,
}));

const buscarLojaParaPedido = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaParaPedido: (...a: unknown[]) => buscarLojaParaPedido(...a),
}));

vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: async () => ({
    cardapios: [],
    vinculosPorProduto: new Map(),
  }),
}));

const buscarProdutosPorIds = vi.fn();
const buscarOpcionaisPorIds = vi.fn();
const buscarOpcionaisPorCategoria = vi.fn();
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosPorIds: (...a: unknown[]) => buscarProdutosPorIds(...a),
  buscarOpcionaisPorIds: (...a: unknown[]) => buscarOpcionaisPorIds(...a),
  buscarOpcionaisPorCategoria: (...a: unknown[]) => buscarOpcionaisPorCategoria(...a),
}));

const buscarPedidoPorToken = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoPorToken: (...a: unknown[]) => buscarPedidoPorToken(...a),
}));

const listarZonasComTaxas = vi.fn();
const listarFormasPagamento = vi.fn();
const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: (...a: unknown[]) => listarZonasComTaxas(...a),
  listarFormasPagamento: (...a: unknown[]) => listarFormasPagamento(...a),
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
}));

const resolverCepServidor = vi.fn();
vi.mock("@/lib/utils/resolverCepServidor", () => ({
  resolverCepServidor: (...a: unknown[]) => resolverCepServidor(...a),
}));

const distanciaDaLojaAoCep = vi.fn();
vi.mock("@/lib/actions/distanciaFrete", () => ({
  distanciaDaLojaAoCep: (...a: unknown[]) => distanciaDaLojaAoCep(...a),
}));

import { criarPedido } from "./pedido";

// ─────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const PROD_1 = "aaaaaaaa-0000-0000-0000-000000000001"; // R$ 25,00
const CUPOM_ID = "cccccccc-0000-0000-0000-000000000001";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000001";
const TOKEN = "77777777-0000-0000-0000-000000000009";

const HORARIO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS_SEMPRE = {
  seg: HORARIO, ter: HORARIO, qua: HORARIO, qui: HORARIO,
  sex: HORARIO, sab: HORARIO, dom: HORARIO,
};

const ENDERECO = { cep: "01000-000", rua: "Rua X", numero: "10", bairro: "Centro" };

type ModalidadesLoja = {
  aceita_retirada?: boolean;
  aceita_entrega?: boolean;
  modo_frete?: "automatico" | "a_combinar";
  taxa_entrega_fora_zona?: number | null;
};

/** Linha de `lojas` como `buscarLojaParaPedido` (select *) a devolve depois da migration. */
function lojaRow(over: ModalidadesLoja = {}) {
  return {
    id: LOJA_A,
    nome: "Loja A",
    ativo: true,
    horarios: HORARIOS_SEMPRE,
    timezone: "America/Sao_Paulo",
    assinatura_status: "ativa",
    assinatura_fim_periodo: "2099-01-01T00:00:00.000Z",
    taxa_entrega_fora_zona: null,
    whatsapp: null,
    whatsapp_envio_automatico: false,
    // Defaults da migration: loja existente = comportamento de hoje.
    aceita_retirada: true,
    aceita_entrega: true,
    modo_frete: "automatico",
    ...over,
  };
}

function produtoRow(): Tables<"produtos"> {
  return {
    id: PROD_1,
    loja_id: LOJA_A,
    categoria_id: null,
    nome: "Pizza",
    descricao: null,
    preco: 25.0,
    disponivel: true,
    oculto: false,
    ordem: 0,
    foto_url: null,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    visibilidade: "menu",
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
  };
}

/** Cupom de 10% sem pedido mínimo: sobre R$ 50,00 desconta R$ 5,00. */
function cupom10(): Tables<"cupons"> {
  return {
    id: CUPOM_ID,
    loja_id: LOJA_A,
    codigo: "DEZ",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
  };
}

/** Zona 'Centro' R$ 5,00; `pedidoMinimoGratis` opcional (frete grátis por subtotal). */
function zonaCentro(pedidoMinimoGratis: number | null = null) {
  return [
    {
      id: "z1",
      loja_id: LOJA_A,
      nome: "Centro",
      tipo: "bairro",
      ativo: true,
      taxa: { taxa: 5.0, pedido_minimo_gratis: pedidoMinimoGratis, raio_max_km: null },
      bairros: [{ nome: "Centro" }],
    },
  ];
}

/** 2 × R$ 25,00 = subtotal R$ 50,00. Payload só com intenção (sem valores). */
function payload(over: Record<string, unknown> = {}) {
  return {
    loja_id: LOJA_A,
    tipo_entrega: "entrega",
    itens: [{ produto_id: PROD_1, quantidade: 2 }],
    endereco_entrega: ENDERECO,
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
    ...over,
  };
}

function cenario(loja: ModalidadesLoja = {}) {
  buscarLojaParaPedido.mockResolvedValue(lojaRow(loja));
  listarFormasPagamento.mockResolvedValue([{ id: "f1", loja_id: LOJA_A, tipo: "pix", config: {} }]);
  buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
  buscarOpcionaisPorIds.mockResolvedValue([]);
  buscarOpcionaisPorCategoria.mockResolvedValue({});
  listarZonasComTaxas.mockResolvedValue(zonaCentro());
  buscarCupomPorCodigo.mockResolvedValue(null);
  buscarPedidoPorToken.mockResolvedValue(null);
  resolverCepServidor.mockResolvedValue({
    endereco: { bairro: "Centro", logradouro: "Praça da Sé", cidade: "São Paulo", uf: "SP" },
  });
  distanciaDaLojaAoCep.mockResolvedValue({ km: undefined, causa: "sem_cep" });
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }],
    error: null,
  });
}

type ArgsRpc = {
  p_tipo_entrega: string;
  p_taxa_entrega: number | null;
  p_frete_a_combinar: boolean;
  p_subtotal: number;
  p_desconto: number;
  p_total: number;
  p_endereco_entrega: Record<string, unknown> | null;
};

function argsRpc(): ArgsRpc {
  expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  const [fn, args] = fakeClient.rpc.mock.calls[0] as [string, ArgsRpc];
  expect(fn).toBe("criar_pedido");
  return args;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.rpc.mockReset();
});

// ═════════════════════════════════════════ (1) modalidade desligada na loja
describe("[modalidades · B1] modalidade desligada é recusada no servidor", () => {
  it("loja com ENTREGA desligada + payload tipo_entrega='entrega' → { erro } e RPC NÃO chamada", async () => {
    cenario({ aceita_entrega: false, aceita_retirada: true });
    const r = await criarPedido(payload());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("loja com RETIRADA desligada + payload tipo_entrega='retirada' → { erro } e RPC NÃO chamada", async () => {
    cenario({ aceita_retirada: false, aceita_entrega: true });
    const r = await criarPedido(payload({ tipo_entrega: "retirada", endereco_entrega: undefined }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("entrega desligada: a recusa vem ANTES da onda de leituras (sem ler produtos, zonas nem geocoding)", async () => {
    // Plano P3: "recusar tipo_entrega desligado antes da onda de leituras".
    cenario({ aceita_entrega: false, aceita_retirada: true });
    await criarPedido(payload());
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
    expect(distanciaDaLojaAoCep).not.toHaveBeenCalled();
    expect(resolverCepServidor).not.toHaveBeenCalled();
  });

  it("não recusa demais: retirada desligada NÃO impede um pedido de ENTREGA (frete 5 da zona)", async () => {
    cenario({ aceita_retirada: false, aceita_entrega: true });
    const r = await criarPedido(payload());
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    const args = argsRpc();
    expect(args.p_tipo_entrega).toBe("entrega");
    expect(args.p_taxa_entrega).toBe(5);
  });

  it("não recusa demais: entrega desligada NÃO impede um pedido de RETIRADA", async () => {
    cenario({ aceita_entrega: false, aceita_retirada: true });
    const r = await criarPedido(payload({ tipo_entrega: "retirada", endereco_entrega: undefined }));
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    expect(argsRpc().p_tipo_entrega).toBe("retirada");
  });
});

// ═════════════════════════════════════════ (2)(3)(4) modo a combinar
describe("[modalidades · B2] modo_frete='a_combinar' — o pedido nasce a combinar", () => {
  it("subtotal 50 + cupom 10% → p_taxa_entrega null, p_frete_a_combinar true, p_desconto 5, p_total 45", async () => {
    cenario({ modo_frete: "a_combinar" });
    buscarCupomPorCodigo.mockResolvedValue(cupom10());

    const r = await criarPedido(payload({ codigo_cupom: "DEZ" }));

    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    const args = argsRpc();
    expect(args.p_subtotal).toBe(50);
    expect(args.p_desconto).toBe(5);
    expect(args.p_taxa_entrega).toBeNull();
    expect(args.p_frete_a_combinar).toBe(true);
    expect(args.p_total).toBe(45);
  });

  it("subtotal ACIMA de pedido_minimo_gratis → continua a combinar (taxa null), NUNCA frete grátis 0", async () => {
    cenario({ modo_frete: "a_combinar" });
    // Zona que daria frete grátis a partir de R$ 30,00; o pedido tem R$ 50,00.
    listarZonasComTaxas.mockResolvedValue(zonaCentro(30));

    await criarPedido(payload());

    const args = argsRpc();
    expect(args.p_frete_a_combinar).toBe(true);
    expect(args.p_taxa_entrega).toBeNull();
    expect(args.p_taxa_entrega).not.toBe(0);
    expect(args.p_total).toBe(50);
  });

  it("zona que casaria com R$ 5,00 é IGNORADA no modo a combinar (o sistema não calcula o frete)", async () => {
    cenario({ modo_frete: "a_combinar" });
    await criarPedido(payload());
    const args = argsRpc();
    expect(args.p_taxa_entrega).toBeNull();
    expect(args.p_frete_a_combinar).toBe(true);
    expect(args.p_total).toBe(50);
  });

  it("sem verificação de distância nem ViaCEP: distanciaDaLojaAoCep e resolverCepServidor NÃO chamados", async () => {
    cenario({ modo_frete: "a_combinar" });
    await criarPedido(payload());
    expect(distanciaDaLojaAoCep).not.toHaveBeenCalled();
    expect(resolverCepServidor).not.toHaveBeenCalled();
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("sem verificação de zona: endereço FORA de toda zona e loja sem fallback → pedido criado a combinar", async () => {
    cenario({ modo_frete: "a_combinar", taxa_entrega_fora_zona: null });
    listarZonasComTaxas.mockResolvedValue([]);
    const r = await criarPedido(
      payload({ endereco_entrega: { ...ENDERECO, bairro: "Subúrbio Distante" } }),
    );
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    const args = argsRpc();
    expect(args.p_frete_a_combinar).toBe(true);
    expect(args.p_taxa_entrega).toBeNull();
  });

  it("zonas não são carregadas no modo a combinar (plano P3: não usar zonas)", async () => {
    cenario({ modo_frete: "a_combinar" });
    await criarPedido(payload());
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
  });

  it("endereço é gravado como enviado (rua, número, bairro, CEP), sem distanciaKm", async () => {
    cenario({ modo_frete: "a_combinar" });
    // Se o geocoding fosse consultado, a distância REAL entraria no snapshot —
    // o default `sem_cep` esconderia a chamada; aqui ela deixaria rastro.
    distanciaDaLojaAoCep.mockResolvedValue({ km: 3.2, causa: "ok" });
    await criarPedido(payload());
    const args = argsRpc();
    expect(args.p_endereco_entrega).toMatchObject(ENDERECO);
    expect(args.p_endereco_entrega).not.toHaveProperty("distanciaKm");
  });

  it("endereço continua obrigatório: entrega a combinar SEM endereço → { erro }, RPC não chamada", async () => {
    cenario({ modo_frete: "a_combinar" });
    const r = await criarPedido(payload({ endereco_entrega: undefined }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("retirada numa loja a combinar é ortogonal: p_taxa_entrega 0 e p_frete_a_combinar false", async () => {
    cenario({ modo_frete: "a_combinar" });
    await criarPedido(payload({ tipo_entrega: "retirada", endereco_entrega: undefined }));
    const args = argsRpc();
    expect(args.p_tipo_entrega).toBe("retirada");
    expect(args.p_taxa_entrega).toBe(0);
    expect(args.p_frete_a_combinar).toBe(false);
    expect(args.p_total).toBe(50);
  });

  it("modo_frete forjado no payload é barrado pelo .strict() antes de qualquer I/O", async () => {
    cenario({ modo_frete: "automatico" });
    const r = await criarPedido(payload({ modo_frete: "a_combinar" }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(buscarLojaParaPedido).not.toHaveBeenCalled();
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════ (5) automático fora de zona
describe("[modalidades · B3] modo automático continua como hoje", () => {
  it("fora de toda zona e SEM taxa_entrega_fora_zona → { erro }, RPC não chamada", async () => {
    cenario({ modo_frete: "automatico", taxa_entrega_fora_zona: null });
    listarZonasComTaxas.mockResolvedValue([]);
    const r = await criarPedido(payload());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("fora de toda zona COM taxa_entrega_fora_zona=8 → cobra 8, p_frete_a_combinar false", async () => {
    cenario({ modo_frete: "automatico", taxa_entrega_fora_zona: 8 });
    listarZonasComTaxas.mockResolvedValue([]);
    await criarPedido(payload());
    const args = argsRpc();
    expect(args.p_taxa_entrega).toBe(8);
    expect(args.p_frete_a_combinar).toBe(false);
    expect(args.p_total).toBe(58);
  });
});
