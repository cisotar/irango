import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 342 — `criarPedido` com vínculo de cliente e cupom por cliente.
 * Arquivo NOVO (gate C3: `pedido.test.ts` e irmãos ficam intocados).
 *
 * Autoridade: tasks/342 §RED · specs/cliente-vinculo-pedido.md RN-C02, RN-C08..C11 · plano C2.
 *
 * Contrato que a fase GREEN (P28) precisa satisfazer:
 *  - `cliente_id` vem de `getUser()` do client da SESSÃO (`@/lib/supabase/server`), nunca do
 *    payload (`.strict()` recusa `cliente_id`). Só é usado se `email_confirmed_at` E perfil em
 *    `clientes` (`buscarPerfilCliente`, `@/lib/supabase/queries/clientes`). Senão null.
 *    Falha ao resolver a sessão → convidado (null), pedido segue (fail-safe: convidado tem
 *    MENOS benefício, nunca mais).
 *  - A RPC recebe SEMPRE 18 args nomeados, com `p_cliente_id` presente (null explícito p/ convidado).
 *  - Cupom com `limite_por_cliente`:
 *      convidado → p_desconto 0, p_cupom_id null, p_cupom_codigo null, pedido criado,
 *                  sucesso com `avisoCupom: "Entre na sua conta para usar este cupom"`;
 *      logado → `contarUsosCupomDoCliente(svc, { lojaId, clienteId, codigo })`
 *               (`@/lib/supabase/queries/pedidos`); usos >= limite → desconto 0 e
 *               `avisoCupom: "Você já usou este cupom o máximo de vezes permitido."`.
 *  - Cupom sem limite → idêntico a hoje (nenhuma contagem por cliente).
 *
 * Por que é RED: a action não lê sessão, não manda `p_cliente_id` e ignora `limite_por_cliente`.
 */

vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

// ── sessão (cliente_id autoritativo)
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) } }),
}));
const buscarPerfilCliente = vi.fn();
vi.mock("@/lib/supabase/queries/clientes", () => ({
  buscarPerfilCliente: (...a: unknown[]) => buscarPerfilCliente(...a),
}));

// ── service_role + queries (mesmo padrão de pedido.test.ts)
const fakeClient = { __fake: "service-client", rpc: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeClient }));

const buscarLojaParaPedido = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaParaPedido: (...a: unknown[]) => buscarLojaParaPedido(...a),
}));
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: async () => ({ cardapios: [], vinculosPorProduto: new Map() }),
}));
vi.mock("@/lib/supabase/queries/categorias", () => ({ buscarCategorias: async () => [] }));
const buscarProdutosPorIds = vi.fn();
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosPorIds: (...a: unknown[]) => buscarProdutosPorIds(...a),
  buscarOpcionaisPorIds: async () => [],
  buscarOpcionaisPorCategoria: async () => ({}),
}));
vi.mock("@/lib/supabase/queries/opcionais", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  buscarOcultosPorProdutos: async () => [],
}));
const contarUsosCupomDoCliente = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoPorToken: async () => null,
  contarUsosCupomDoCliente: (...a: unknown[]) => contarUsosCupomDoCliente(...a),
}));
const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: async () => [
    {
      id: "z1",
      loja_id: LOJA_A,
      nome: "Centro",
      tipo: "bairro",
      ativo: true,
      taxa: { taxa: 5.0, pedido_minimo_gratis: null, raio_max_km: null },
      bairros: [{ nome: "Centro" }],
    },
  ],
  listarFormasPagamento: async () => [{ id: "f1", loja_id: LOJA_A, tipo: "pix", config: {} }],
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
}));
vi.mock("@/lib/utils/resolverCepServidor", () => ({
  resolverCepServidor: async () => ({
    endereco: { bairro: "Centro", logradouro: "Praça da Sé", cidade: "São Paulo", uf: "SP" },
  }),
}));
vi.mock("@/lib/actions/distanciaFrete", () => ({
  distanciaDaLojaAoCep: async () => ({ km: undefined, causa: "sem_cep" }),
}));

import { criarPedido } from "./pedido";

// ─────────────────────────── fixtures (fictícias)
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const PROD_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const CUPOM_ID = "cccccccc-0000-0000-0000-000000000001";
const USER = "c3420000-0000-4000-8000-0000000000ca";
const OUTRO = "c3420000-0000-4000-8000-0000000000cb";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000001";
const TOKEN = "77777777-0000-0000-0000-000000000009";
const MSG_ENTRAR = "Entre na sua conta para usar este cupom";
const MSG_LIMITE = "Você já usou este cupom o máximo de vezes permitido.";

const ABERTO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS = { seg: ABERTO, ter: ABERTO, qua: ABERTO, qui: ABERTO, sex: ABERTO, sab: ABERTO, dom: ABERTO };

function lojaRow() {
  return {
    id: LOJA_A,
    nome: "Loja A",
    ativo: true,
    horarios: HORARIOS,
    timezone: "America/Sao_Paulo",
    assinatura_status: "ativa",
    assinatura_fim_periodo: "2099-01-01T00:00:00.000Z",
    taxa_entrega_fora_zona: null,
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
    dias_semana: null,
    hora_inicio: null,
    hora_fim: null,
    periodo_inicio: null,
    periodo_fim: null,
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
  };
}

/** Cupom fixo R$ 5. `limite_por_cliente` ainda não está nos tipos gerados (regen é P31). */
function cupomRow(limite: number | null) {
  return {
    id: CUPOM_ID,
    loja_id: LOJA_A,
    codigo: "PROMO5",
    tipo: "fixo",
    valor: 5.0,
    pedido_minimo: 0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    limite_por_cliente: limite,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    loja_id: LOJA_A,
    tipo_entrega: "entrega",
    itens: [{ produto_id: PROD_1, quantidade: 2 }],
    endereco_entrega: { cep: "01000-000", rua: "Rua X", numero: "10", bairro: "Centro" },
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
    ...over,
  };
}

function logado(id = USER, confirmado = true) {
  getUser.mockResolvedValue({
    data: { user: { id, email: `u-${id}@teste.local`, email_confirmed_at: confirmado ? "2026-01-01T00:00:00Z" : null } },
    error: null,
  });
  buscarPerfilCliente.mockResolvedValue({ id, nome: "Cliente Teste" });
}

function convidado() {
  getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
  buscarPerfilCliente.mockResolvedValue(null);
}

function argsRpc(): Record<string, unknown> {
  const call = fakeClient.rpc.mock.calls.find((c) => c[0] === "criar_pedido");
  if (call == null) throw new Error("a RPC criar_pedido não foi chamada");
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarLojaParaPedido.mockResolvedValue(lojaRow());
  buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
  buscarCupomPorCodigo.mockResolvedValue(null);
  contarUsosCupomDoCliente.mockResolvedValue(0);
  fakeClient.rpc.mockResolvedValue({ data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }], error: null });
  convidado();
});

// ═══════════════════════════════════════════════════════════════════════════
describe("342 [RN-C02] cliente_id da SESSÃO, nunca do payload", () => {
  it("logado + e-mail confirmado + perfil → p_cliente_id = getUser().id", async () => {
    logado();
    const r = await criarPedido(payload());
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    expect(argsRpc()).toHaveProperty("p_cliente_id", USER);
    expect(buscarPerfilCliente).toHaveBeenCalledWith(expect.anything(), USER);
  });

  it("convidado (sem sessão) → p_cliente_id PRESENTE e null (a RPC de 18 args não tem default)", async () => {
    await criarPedido(payload());
    expect(Object.prototype.hasOwnProperty.call(argsRpc(), "p_cliente_id")).toBe(true);
    expect(argsRpc().p_cliente_id).toBeNull();
  });

  it("logado SEM perfil em clientes → p_cliente_id null (decisão 18)", async () => {
    logado();
    buscarPerfilCliente.mockResolvedValue(null);
    await criarPedido(payload());
    expect(argsRpc()).toHaveProperty("p_cliente_id", null);
  });

  it("logado com e-mail NÃO confirmado → p_cliente_id null (decisão 18)", async () => {
    logado(USER, false);
    await criarPedido(payload());
    expect(argsRpc()).toHaveProperty("p_cliente_id", null);
  });

  it("getUser lança → pedido segue como convidado (p_cliente_id null), sem erro ao cliente", async () => {
    getUser.mockRejectedValue(new Error("rede"));
    const r = await criarPedido(payload());
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    expect(argsRpc()).toHaveProperty("p_cliente_id", null);
  });

  it("[ataque] payload com cliente_id de OUTRO → recusado no .strict(), RPC nunca chamada", async () => {
    logado();
    const r = await criarPedido(payload({ cliente_id: OUTRO }));
    expect(r).toHaveProperty("erro");
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("a chamada carrega exatamente 18 argumentos nomeados (nunca a assinatura antiga)", async () => {
    logado();
    await criarPedido(payload());
    const args = argsRpc();
    expect(Object.keys(args)).toHaveLength(18);
    expect(Object.keys(args)).toContain("p_cliente_id");
    expect(Object.keys(args)).toContain("p_frete_a_combinar");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("342 [RN-C08/C10] cupom com limite_por_cliente", () => {
  it("convidado + cupom com limite → desconto 0, sem p_cupom_id/p_cupom_codigo, total 55, pedido criado com avisoCupom de entrar", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(1));
    const r = await criarPedido(payload({ codigo_cupom: "PROMO5" }));
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID, avisoCupom: MSG_ENTRAR });
    expect(argsRpc()).toMatchObject({
      p_desconto: 0,
      p_cupom_id: null,
      p_cupom_codigo: null,
      p_subtotal: 50,
      p_total: 55,
      p_cliente_id: null,
    });
    expect(contarUsosCupomDoCliente).not.toHaveBeenCalled();
  });

  it("logado no limite (1 uso, limite 1) → desconto 0, pedido criado com avisoCupom de limite", async () => {
    logado();
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(1));
    contarUsosCupomDoCliente.mockResolvedValue(1);
    const r = await criarPedido(payload({ codigo_cupom: "PROMO5" }));
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID, avisoCupom: MSG_LIMITE });
    expect(argsRpc()).toMatchObject({
      p_desconto: 0,
      p_cupom_id: null,
      p_cupom_codigo: null,
      p_total: 55,
      p_cliente_id: USER,
    });
  });

  it("logado com usos disponíveis (1 de 2) → desconto aplicado; contagem escopada por loja+cliente+código", async () => {
    logado();
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(2));
    contarUsosCupomDoCliente.mockResolvedValue(1);
    const r = await criarPedido(payload({ codigo_cupom: "PROMO5" }));
    expect(r).toMatchObject({ pedidoId: PEDIDO_ID });
    expect(r).not.toHaveProperty("avisoCupom");
    expect(argsRpc()).toMatchObject({
      p_desconto: 5,
      p_cupom_id: CUPOM_ID,
      p_cupom_codigo: "PROMO5",
      p_total: 50,
      p_cliente_id: USER,
    });
    expect(contarUsosCupomDoCliente).toHaveBeenCalledWith(fakeClient, {
      lojaId: LOJA_A,
      clienteId: USER,
      codigo: "PROMO5",
    });
  });

  it("convidado + cupom SEM limite → idêntico a hoje (desconto 5) e nenhuma contagem por cliente", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(null));
    const r = await criarPedido(payload({ codigo_cupom: "PROMO5" }));
    expect(r).not.toHaveProperty("avisoCupom");
    expect(argsRpc()).toMatchObject({ p_desconto: 5, p_cupom_id: CUPOM_ID, p_total: 50, p_cliente_id: null });
    expect(contarUsosCupomDoCliente).not.toHaveBeenCalled();
  });

  it("[RN-C11] cupom de outra loja: a busca é escopada pelo loja_id do payload e o pedido sai sem desconto", async () => {
    logado();
    buscarCupomPorCodigo.mockResolvedValue(null); // (loja_id, codigo) não existe nesta loja
    await criarPedido(payload({ codigo_cupom: "PROMO5" }));
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(fakeClient, LOJA_A, "PROMO5");
    expect(argsRpc()).toMatchObject({ p_desconto: 0, p_cupom_id: null, p_cliente_id: USER });
  });
});
