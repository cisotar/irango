// TDD RED-first (issue 128 — crítica): testes da nova Server Action
// consultarStatusPedido(pedidoId, token) que o polling do cliente (8s) chama.
//
// CONTRATO: leitura mínima por posse do token. Retorna SÓ { status, tipo_entrega }
// (nada de PII: nome/telefone/endereço/itens/valores). Par errado/inexistente/
// uuid inválido/erro de banco → { encontrado: false } genérico (anti-enumeração,
// seguranca.md §14). A autorização é POSSE DO TOKEN, validada na query escopada
// `WHERE id AND token_acesso` sob service_role — nenhuma regra vive no cliente.
//
// Issue 329 (fase RED, RN-SC9 — spec status-pedido-clicavel-e-latencia.md,
// Frente 2 item 2): a action passa a usar a LEITURA ENXUTA
// `buscarStatusPedidoPorToken` (só `status, tipo_entrega`) e NUNCA mais
// `buscarPedidoPorToken` (pedido inteiro + itens + opcionais + PII). O contrato de
// retorno `ResultadoStatusPedido` e o rate limit antes da leitura não mudam.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

// --- Mocks de I/O externo (mesmo padrão de revisarCarrinho.test.ts) ---
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const verificarRateLimit = vi.fn(async (..._args: unknown[]) => ({
  permitido: true,
}));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: (...args: unknown[]) => verificarRateLimit(...args),
}));

const fakeClient = { __fake: "service-client" };
const createServiceClient = vi.fn(() => fakeClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Leitura ENXUTA (329) — a única via permitida no polling.
const buscarStatusPedidoPorToken = vi.fn();
// Leitura COMPLETA — espiã para provar que o polling NUNCA mais a usa.
const buscarPedidoPorToken = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarStatusPedidoPorToken: (...args: unknown[]) => buscarStatusPedidoPorToken(...args),
  buscarPedidoPorToken: (...args: unknown[]) => buscarPedidoPorToken(...args),
}));

// Import da action nova (ainda não existe → testes vermelhos agora)
import { consultarStatusPedido } from "./consultarStatusPedido";

const PEDIDO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TOKEN_OK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TOKEN_ERRADO = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// Linha completa COM PII/valores — defesa em profundidade: mesmo que a
// projeção da query regrida e devolva a linha inteira, a action descarta tudo
// exceto status e tipo_entrega.
function pedidoRow(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: PEDIDO_ID,
    loja_id: "11111111-1111-1111-1111-111111111111",
    token_acesso: TOKEN_OK,
    status: "em_preparo",
    tipo_entrega: "entrega",
    nome_cliente: "Fulano Secreto",
    telefone_cliente: "+5511999998888",
    endereco_entrega: { rua: "Rua Privada", numero: "42" },
    subtotal: 4200,
    taxa_entrega: 800,
    desconto: 0,
    total: 5000,
    criado_em: "2026-07-04T12:00:00.000Z",
    itens: [
      { id: "item-1", nome_produto: "X-Burger", quantidade: 2 },
    ],
    ...over,
  } as unknown as PedidoComItens;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consultarStatusPedido (128 — polling status por token)", () => {
  // ── Caminho feliz ──────────────────────────────────────────────────────────

  it("par (id, token) válido → { encontrado:true, status, tipo_entrega }", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(pedidoRow({ status: "em_preparo" }));
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(r).toEqual({
      encontrado: true,
      status: "em_preparo",
      tipo_entrega: "entrega",
    });
  });

  it("escopa a leitura por (id, token) via service_role", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(pedidoRow());
    await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(buscarStatusPedidoPorToken).toHaveBeenCalledWith(
      fakeClient,
      PEDIDO_ID,
      TOKEN_OK,
    );
  });

  it("propaga o status autoritativo do banco (ex.: cancelado)", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(pedidoRow({ status: "cancelado" }));
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(r).toMatchObject({ encontrado: true, status: "cancelado" });
  });

  // ── Superfície mínima: NENHUMA PII trafega no polling ──────────────────────

  it("retorno encontrado tem exatamente { encontrado, status, tipo_entrega } — sem PII", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(pedidoRow());
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(Object.keys(r).sort()).toEqual(
      ["encontrado", "status", "tipo_entrega"].sort(),
    );
  });

  it("retorno NÃO contém nome/telefone/endereço/itens/valores", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(pedidoRow());
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    const serializado = JSON.stringify(r);
    for (const vazamento of [
      "nome_cliente",
      "telefone_cliente",
      "endereco_entrega",
      "itens",
      "subtotal",
      "total",
      "Fulano Secreto",
      "Rua Privada",
      "999998888",
    ]) {
      expect(serializado).not.toContain(vazamento);
    }
  });

  // ── Anti-enumeração: par errado indistinguível de inexistente ──────────────

  it("token errado (id válido) → { encontrado:false }", async () => {
    // buscarStatusPedidoPorToken escopado (id, token errado) não casa → null
    buscarStatusPedidoPorToken.mockResolvedValue(null);
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_ERRADO);
    expect(r).toEqual({ encontrado: false });
  });

  it("id inexistente → { encontrado:false } (mesmo shape que token errado)", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(null);
    const r = await consultarStatusPedido(
      "dddddddd-dddd-dddd-dddd-dddddddddddd",
      TOKEN_OK,
    );
    expect(r).toEqual({ encontrado: false });
  });

  // ── Validação de input: UUID malformado NÃO toca o banco ───────────────────

  it("pedidoId não-UUID → { encontrado:false } SEM I/O", async () => {
    const r = await consultarStatusPedido("nao-uuid", TOKEN_OK);
    expect(r).toEqual({ encontrado: false });
    expect(buscarStatusPedidoPorToken).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("token não-UUID → { encontrado:false } SEM I/O", async () => {
    const r = await consultarStatusPedido(PEDIDO_ID, "token-invalido");
    expect(r).toEqual({ encontrado: false });
    expect(buscarStatusPedidoPorToken).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("campos vazios → { encontrado:false } SEM I/O", async () => {
    const r = await consultarStatusPedido("", "");
    expect(r).toEqual({ encontrado: false });
    expect(buscarStatusPedidoPorToken).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  // ── Erro de banco: log servidor + shape genérico, sem vazar erro ───────────

  it("erro de banco → { encontrado:false } + log no servidor, sem vazar e.message", async () => {
    const erro = new Error("connection refused: credencial secreta XYZ");
    buscarStatusPedidoPorToken.mockRejectedValue(erro);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);

    expect(r).toEqual({ encontrado: false });
    expect(spy).toHaveBeenCalledWith("[consultarStatusPedido]", erro);
    expect(JSON.stringify(r)).not.toContain("credencial");
    spy.mockRestore();
  });

  // ── Bordas adicionais ───────────────────────────────────────────────────────

  it("status fora do enum (drift de schema/dado legado) é propagado como veio do banco — não filtra nem lança", async () => {
    // A action não valida o enum do status: é dado autoritativo do banco e o
    // cliente decide o que fazer. Se um refactor futuro passar a filtrar/whitelist
    // silenciosamente, este teste quebra.
    buscarStatusPedidoPorToken.mockResolvedValue(
      pedidoRow({ status: "status_desconhecido_legado" as never }),
    );
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(r).toEqual({
      encontrado: true,
      status: "status_desconhecido_legado",
      tipo_entrega: "entrega",
    });
  });

  it("tipo_entrega 'retirada' é propagado literalmente (coluna NOT NULL no schema)", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(pedidoRow({ tipo_entrega: "retirada" }));
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(r).toEqual({
      encontrado: true,
      status: "em_preparo",
      tipo_entrega: "retirada",
    });
  });

  it("pedidoId com espaço à volta (uuid válido + whitespace) → { encontrado:false } SEM I/O", async () => {
    const r = await consultarStatusPedido(` ${PEDIDO_ID} `, TOKEN_OK);
    expect(r).toEqual({ encontrado: false });
    expect(buscarStatusPedidoPorToken).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("token com espaço à volta (uuid válido + whitespace) → { encontrado:false } SEM I/O", async () => {
    const r = await consultarStatusPedido(PEDIDO_ID, ` ${TOKEN_OK} `);
    expect(r).toEqual({ encontrado: false });
    expect(buscarStatusPedidoPorToken).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  // ── Rate limit server-side ─────────────────────────────────────────────────

  it("rate limit excedido → { encontrado:false } genérico SEM tocar o banco", async () => {
    verificarRateLimit.mockResolvedValueOnce({ permitido: false });
    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);
    expect(r).toEqual({ encontrado: false });
    expect(verificarRateLimit).toHaveBeenCalledWith("statusPedido", "203.0.113.7");
    expect(buscarStatusPedidoPorToken).not.toHaveBeenCalled();
  });

  // ── Issue 329: leitura enxuta (RN-SC9) ─────────────────────────────────────

  it("[329] usa buscarStatusPedidoPorToken e NUNCA buscarPedidoPorToken (sem ler itens/PII)", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue({ status: "confirmado", tipo_entrega: "retirada" });

    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);

    expect(r).toEqual({ encontrado: true, status: "confirmado", tipo_entrega: "retirada" });
    expect(buscarStatusPedidoPorToken).toHaveBeenCalledTimes(1);
    expect(buscarStatusPedidoPorToken).toHaveBeenCalledWith(fakeClient, PEDIDO_ID, TOKEN_OK);
    expect(buscarPedidoPorToken).not.toHaveBeenCalled();
  });

  it("[329] par errado pela leitura enxuta (null) → { encontrado:false }, sem cair na leitura completa", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue(null);

    const r = await consultarStatusPedido(PEDIDO_ID, TOKEN_ERRADO);

    expect(r).toEqual({ encontrado: false });
    expect(buscarStatusPedidoPorToken).toHaveBeenCalledTimes(1);
    expect(buscarPedidoPorToken).not.toHaveBeenCalled();
  });

  it("[329] rate limit roda ANTES da leitura enxuta", async () => {
    buscarStatusPedidoPorToken.mockResolvedValue({ status: "pendente", tipo_entrega: "entrega" });

    await consultarStatusPedido(PEDIDO_ID, TOKEN_OK);

    expect(verificarRateLimit).toHaveBeenCalledTimes(1);
    expect(buscarStatusPedidoPorToken).toHaveBeenCalledTimes(1);
    expect(verificarRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      buscarStatusPedidoPorToken.mock.invocationCallOrder[0],
    );
  });
});
