import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 342 — `revisarCarrinhoAction` aplica a MESMA regra de cupom por
 * cliente que `criarPedido` (decisões 9/9-A), no slot JÁ existente
 * `VereditoCupom { valido: false; mensagem }` — nenhum estado novo de cupom.
 * Arquivo NOVO; `revisarCarrinho.test.ts` intocado.
 *
 * Contrato: sessão via `getUser()` (`@/lib/supabase/server`) + perfil (`buscarPerfilCliente`)
 * + `contarUsosCupomDoCliente(svc, { lojaId, clienteId, codigo })`, mesma regra pura
 * `avaliarCupomPorCliente` (src/lib/utils/cupomPorCliente.ts). Fixture ESPELHO de
 * `pedido.cliente.test.ts` (mesmo cupom, mesmo carrinho) — anti-drift preview × servidor.
 *
 * Por que é RED: a revisão ignora `limite_por_cliente` e devolve `valido: true`.
 */

vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) } }),
}));
const buscarPerfilCliente = vi.fn();
vi.mock("@/lib/supabase/queries/clientes", () => ({
  buscarPerfilCliente: (...a: unknown[]) => buscarPerfilCliente(...a),
}));
const contarUsosCupomDoCliente = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoPorToken: async () => null,
  contarUsosCupomDoCliente: (...a: unknown[]) => contarUsosCupomDoCliente(...a),
}));

const fakeClient = { __fake: "service-client" };
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeClient }));
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
const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
}));
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaParaPedido: async () => ({
    id: LOJA_A,
    nome: "Loja A",
    ativo: true,
    assinatura_status: "ativa",
    assinatura_fim_periodo: "2099-01-01T00:00:00.000Z",
  }),
}));
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: async () => ({ cardapios: [], vinculosPorProduto: new Map() }),
}));
vi.mock("@/lib/supabase/queries/categorias", () => ({ buscarCategorias: async () => [] }));

import { revisarCarrinhoAction } from "./revisarCarrinho";

const LOJA_A = "11111111-1111-1111-1111-111111111111";
const PROD_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const CUPOM_ID = "cccccccc-0000-0000-0000-000000000001";
const USER = "c3420000-0000-4000-8000-0000000000ca";
const MSG_ENTRAR = "Entre na sua conta para usar este cupom";
const MSG_LIMITE = "Você já usou este cupom o máximo de vezes permitido.";

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

const carrinho = { loja_id: LOJA_A, codigo: "PROMO5", itens: [{ produto_id: PROD_1, quantidade: 2 }] };

function logado() {
  getUser.mockResolvedValue({
    data: { user: { id: USER, email: `u-${USER}@teste.local`, email_confirmed_at: "2026-01-01T00:00:00Z" } },
    error: null,
  });
  buscarPerfilCliente.mockResolvedValue({ id: USER, nome: "Cliente Teste" });
}

async function veredito() {
  const r = await revisarCarrinhoAction(carrinho);
  if (!r.ok) throw new Error(`esperava ok:true, veio ok:false (${r.mensagem})`);
  return r.cupom;
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
  contarUsosCupomDoCliente.mockResolvedValue(0);
  getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
  buscarPerfilCliente.mockResolvedValue(null);
});

describe("342 revisarCarrinhoAction — cupom por cliente no slot valido:false", () => {
  it("convidado + cupom com limite → { valido: false, mensagem: entrar na conta } (9-A)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(1));
    expect(await veredito()).toEqual({ valido: false, mensagem: MSG_ENTRAR });
    expect(contarUsosCupomDoCliente).not.toHaveBeenCalled();
  });

  it("logado no limite (1 de 1) → { valido: false, mensagem: limite }", async () => {
    logado();
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(1));
    contarUsosCupomDoCliente.mockResolvedValue(1);
    expect(await veredito()).toEqual({ valido: false, mensagem: MSG_LIMITE });
    expect(contarUsosCupomDoCliente).toHaveBeenCalledWith(fakeClient, {
      lojaId: LOJA_A,
      clienteId: USER,
      codigo: "PROMO5",
    });
  });

  it("logado com usos (1 de 2) → valido: true com o desconto de hoje", async () => {
    logado();
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(2));
    contarUsosCupomDoCliente.mockResolvedValue(1);
    const v = await veredito();
    expect(v).toMatchObject({ valido: true, estadoCupom: { codigo: "PROMO5", desconto: 5 } });
    expect(contarUsosCupomDoCliente).toHaveBeenCalledTimes(1);
  });

  it("convidado + cupom SEM limite → valido: true, sem contagem por cliente (RN-C09)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow(null));
    expect(await veredito()).toMatchObject({ valido: true, estadoCupom: { desconto: 5 } });
    expect(contarUsosCupomDoCliente).not.toHaveBeenCalled();
    // A revisão de convidado com cupom sem limite consulta a sessão no máximo uma vez.
    expect(getUser.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
