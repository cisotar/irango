import { describe, it, expect, beforeEach, vi } from "vitest";

// =============================================================================
// Fase RED (TDD) — issue 077 (crítica: SIM, billing). Teste de UNIDADE do Route
// Handler POST /api/webhooks/billing/[provider], com os colaboradores de I/O e o
// adapter MOCKADOS. Prova a ORQUESTRAÇÃO e as INVARIANTES DE SEGURANÇA do único
// caminho que escreve assinatura_*/billing_* via service_role:
//
//   ordem: (1) provider válido → (2) validar assinatura → (3) idempotência →
//          (4) lookup loja por subscription_id → (5) mapear evento → (6) aplicar.
//   Invariantes: 401 antes de QUALQUER efeito; replay = no-op (não reaplica);
//   provider desconhecido = 404; RN-9 (provider X não toca loja de outro
//   provider); RN-10 (loja cancelada não reativa por renovação espúria);
//   evento desconhecido = 200 sem UPDATE; valor da fatura vem do payload (§10).
//
// Hoje NADA disto existe:
//   - src/app/api/webhooks/billing/[provider]/route.ts        (CRIAR — GREEN)
//   - src/lib/supabase/queries/webhookBilling.ts              (CRIAR — GREEN)
//   - BillingProvider.extrairSubscriptionId                   (CRIAR — GREEN)
// → o `import { POST } from "./route"` quebra por módulo inexistente: RED por
//   import. Quando o route.ts virar STUB que `throw`, vira RED por asserção.
//   Ambos são vermelho legítimo ANTES da implementação.
//
// CONTRATO esperado pela fase GREEN (caminhos que o handler importa):
//   - "@/lib/supabase/service"  → createServiceClient()
//   - "@/lib/billing/providers"  → getBillingProvider(provider): BillingProvider
//        BillingProvider.validarWebhook(headers, rawBody): boolean
//        BillingProvider.extrairEventoId(payload): string | null
//        BillingProvider.extrairSubscriptionId(payload): string | null  [NOVO]
//        BillingProvider.mapearEvento(payload): EventoBilling | null
//        BillingProvider.extrairDados(payload): { valor, provider_payment_id, ... }
//        getBillingProvider lança p/ provider desconhecido (fail-closed) → 404
//   - "@/lib/supabase/queries/webhookBilling" →
//        registrarEventoBilling(client, { provider, evento_id, tipo, payload })
//           → resolve (evento novo) | rejeita { code: "23505" } (replay)
//        buscarLojaPorSubscriptionId(client, provider, subId) → loja | null
//        aplicarStatusBilling(client, lojaId, { status, fim_periodo, ... })
//        registrarPagamento(client, { loja_id, provider, valor, status, ... })
//   - "@/lib/utils/assinatura" → eventoBillingParaStatus(provider, tipo)  [REAL, puro]
//
// `eventoBillingParaStatus` NÃO é mockado — é puro (075); o handler o usa de
// verdade. O `provider.mapearEvento` (mockado) devolve o EventoBilling lógico que
// alimenta `eventoBillingParaStatus`.
// =============================================================================

// ---- mock do adapter (controlável por teste) --------------------------------
const validarWebhook = vi.fn();
const extrairEventoId = vi.fn();
const extrairSubscriptionId = vi.fn();
const mapearEvento = vi.fn();
const extrairDados = vi.fn();
const getBillingProvider = vi.fn();

// ---- mocks dos colaboradores de I/O -----------------------------------------
const registrarEventoBilling = vi.fn();
const buscarLojaPorSubscriptionId = vi.fn();
const aplicarStatusBilling = vi.fn();
const registrarPagamento = vi.fn();
const createServiceClient = vi.fn(() => ({ __mock: "service-client" }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));
vi.mock("@/lib/billing/providers", () => ({
  getBillingProvider: (...a: unknown[]) => getBillingProvider(...a),
}));
vi.mock("@/lib/supabase/queries/webhookBilling", () => ({
  registrarEventoBilling: (...a: unknown[]) => registrarEventoBilling(...a),
  buscarLojaPorSubscriptionId: (...a: unknown[]) => buscarLojaPorSubscriptionId(...a),
  aplicarStatusBilling: (...a: unknown[]) => aplicarStatusBilling(...a),
  registrarPagamento: (...a: unknown[]) => registrarPagamento(...a),
}));

import { POST } from "./route";

// ---- fixtures ---------------------------------------------------------------
const LOJA_ASAAS = {
  id: "loja-asaas-1",
  dono_id: "dono-1",
  billing_provider: "asaas",
  provider_subscription_id: "sub_123",
  assinatura_status: "trial",
  assinatura_inicio: null,
  assinatura_fim_periodo: null,
};
const LOJA_CANCELADA = {
  ...LOJA_ASAAS,
  id: "loja-cancel",
  assinatura_status: "cancelada",
};

function ctx(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.irango.local/api/webhooks/billing/asaas", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function payloadCobranca(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    event: "PAYMENT_CONFIRMED",
    payment: { id: "pay_1", value: 49.9, subscription: "sub_123", billingType: "PIX" },
    ...overrides,
  };
}

const adapter = {
  validarWebhook: (...a: unknown[]) => validarWebhook(...a),
  extrairEventoId: (...a: unknown[]) => extrairEventoId(...a),
  extrairSubscriptionId: (...a: unknown[]) => extrairSubscriptionId(...a),
  mapearEvento: (...a: unknown[]) => mapearEvento(...a),
  extrairDados: (...a: unknown[]) => extrairDados(...a),
};

beforeEach(() => {
  vi.clearAllMocks();
  // por padrão: provider asaas válido, assinatura válida, evento novo, loja encontrada
  getBillingProvider.mockReturnValue(adapter);
  validarWebhook.mockReturnValue(true);
  extrairEventoId.mockReturnValue("evt-1");
  extrairSubscriptionId.mockReturnValue("sub_123");
  mapearEvento.mockReturnValue("cobranca_aprovada");
  extrairDados.mockReturnValue({
    provider_payment_id: "pay_1",
    valor: 49.9,
    metodo: "pix",
    fatura_url: null,
    competencia: null,
  });
  registrarEventoBilling.mockResolvedValue(undefined);
  buscarLojaPorSubscriptionId.mockResolvedValue(LOJA_ASAAS);
  aplicarStatusBilling.mockResolvedValue(undefined);
  registrarPagamento.mockResolvedValue(undefined);
});

describe("POST webhook billing — autenticidade (RN/§10)", () => {
  it("assinatura INVÁLIDA → 401 e ZERO efeito (não registra evento, não toca loja)", async () => {
    validarWebhook.mockReturnValue(false);

    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(401);
    expect(registrarEventoBilling).not.toHaveBeenCalled();
    expect(buscarLojaPorSubscriptionId).not.toHaveBeenCalled();
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
    expect(registrarPagamento).not.toHaveBeenCalled();
  });
});

describe("POST webhook billing — provider da URL (D-5, fail-closed)", () => {
  it("provider DESCONHECIDO → 404 e ZERO efeito", async () => {
    getBillingProvider.mockImplementation(() => {
      throw new Error("Provider de billing desconhecido: stripe");
    });

    const res = await POST(req(payloadCobranca()), ctx("stripe"));

    expect(res.status).toBe(404);
    expect(registrarEventoBilling).not.toHaveBeenCalled();
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
  });
});

describe("POST webhook billing — idempotência (UNIQUE provider,evento_id)", () => {
  it("payload SEM evento_id → 400, nada gravado", async () => {
    extrairEventoId.mockReturnValue(null);

    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(400);
    expect(registrarEventoBilling).not.toHaveBeenCalled();
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
  });

  it("REPLAY (registrarEventoBilling rejeita 23505) → 200 no-op, NÃO aplica status nem pagamento", async () => {
    registrarEventoBilling.mockRejectedValue({ code: "23505" });

    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(200);
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
    expect(registrarPagamento).not.toHaveBeenCalled();
  });
});

describe("POST webhook billing — aplicação de efeito (caminho feliz)", () => {
  it("cobrança aprovada (evento novo) → registra evento + UPDATE loja 'ativa' + registra pagamento + 200", async () => {
    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(200);
    expect(registrarEventoBilling).toHaveBeenCalledTimes(1);
    expect(aplicarStatusBilling).toHaveBeenCalledTimes(1);

    const [, lojaId, dados] = aplicarStatusBilling.mock.calls[0];
    expect(lojaId).toBe(LOJA_ASAAS.id);
    expect(dados.status).toBe("ativa");
    expect(dados.fim_periodo).toBeInstanceOf(Date);

    // ORDEM: evento registrado ANTES do efeito (trava de idempotência atômica)
    expect(registrarEventoBilling.mock.invocationCallOrder[0]).toBeLessThan(
      aplicarStatusBilling.mock.invocationCallOrder[0],
    );
  });

  it("valor da fatura vem do PAYLOAD do provider (§10/RN-1), nunca do cliente", async () => {
    extrairDados.mockReturnValue({
      provider_payment_id: "pay_9",
      valor: 99.0,
      metodo: "pix",
      fatura_url: null,
      competencia: null,
    });

    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(200);
    expect(registrarPagamento).toHaveBeenCalledTimes(1);
    const [, pagamento] = registrarPagamento.mock.calls[0];
    expect(pagamento.valor).toBe(99.0);
    expect(pagamento.provider).toBe("asaas");
  });

  it("reembolso → UPDATE loja 'suspensa' (corte imediato) + 200", async () => {
    mapearEvento.mockReturnValue("reembolso");

    const res = await POST(
      req(payloadCobranca({ id: "evt-ref", event: "PAYMENT_REFUNDED" })),
      ctx("asaas"),
    );

    expect(res.status).toBe(200);
    expect(aplicarStatusBilling).toHaveBeenCalledTimes(1);
    const [, , dados] = aplicarStatusBilling.mock.calls[0];
    expect(dados.status).toBe("suspensa");
  });
});

describe("POST webhook billing — isolamento por provider (RN-9)", () => {
  it("loja não casa o subscription_id do provider da URL → 200 sem UPDATE", async () => {
    // a RPC loja_por_subscription_id filtra billing_provider=$provider no banco:
    // loja de outro provider NÃO retorna → buscarLojaPorSubscriptionId resolve null
    buscarLojaPorSubscriptionId.mockResolvedValue(null);

    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(200);
    expect(registrarEventoBilling).toHaveBeenCalledTimes(1); // evento fica registrado p/ auditoria
    expect(aplicarStatusBilling).not.toHaveBeenCalled(); // loja de outro provider intacta
    expect(registrarPagamento).not.toHaveBeenCalled();
  });

  it("fallback: loja encontrada mas billing_provider != provider da URL → 200 sem UPDATE", async () => {
    buscarLojaPorSubscriptionId.mockResolvedValue({
      ...LOJA_ASAAS,
      billing_provider: "hotmart",
    });

    const res = await POST(req(payloadCobranca()), ctx("asaas"));

    expect(res.status).toBe(200);
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
  });
});

describe("POST webhook billing — evento desconhecido (ignorar, 2xx)", () => {
  it("mapearEvento → null → 200 sem UPDATE (não rejeita, evita retry infinito)", async () => {
    mapearEvento.mockReturnValue(null);

    const res = await POST(req(payloadCobranca({ event: "PAYMENT_AWAITING" })), ctx("asaas"));

    expect(res.status).toBe(200);
    expect(registrarEventoBilling).toHaveBeenCalledTimes(1);
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
  });
});

describe("POST webhook billing — não-reativação de cancelada (RN-10)", () => {
  it("loja 'cancelada' + evento de renovação → 200 SEM reativar (permanece cancelada)", async () => {
    buscarLojaPorSubscriptionId.mockResolvedValue(LOJA_CANCELADA);
    mapearEvento.mockReturnValue("recorrencia_aprovada"); // levaria a 'ativa'

    const res = await POST(
      req(payloadCobranca({ id: "evt-renov", event: "PAYMENT_RECEIVED" })),
      ctx("asaas"),
    );

    expect(res.status).toBe(200);
    // a prova de segurança: nenhum UPDATE que reative a loja cancelada
    expect(aplicarStatusBilling).not.toHaveBeenCalled();
  });
});
