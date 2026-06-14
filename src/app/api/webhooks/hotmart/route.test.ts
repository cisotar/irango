import { describe, it, expect, beforeEach, vi } from "vitest";

// =============================================================================
// Fase RED (TDD) — issue 057 (crítica: SIM). Teste de UNIDADE do Route Handler
// POST /api/webhooks/hotmart, com os colaboradores de I/O MOCKADOS (service
// client + queries). Prova a ORQUESTRAÇÃO e as INVARIANTES DE SEGURANÇA:
//   ordem (1) validar token → (2) idempotência → (3) mapear → (4) aplicar;
//   nada de efeito antes de token válido + evento novo (RN-A1/A2/A3).
//
// Hoje `route.ts` é STUB que `throw` no POST → todos os casos caem VERMELHOS na
// asserção de status/efeito (a suite compila; falha no comportamento).
//
// CONTRATO esperado pela fase GREEN (caminhos que o handler importa):
//   - "@/lib/supabase/service"  → createServiceClient()
//   - "@/lib/supabase/queries/webhookHotmart" →
//        registrarEventoWebhook(client, { evento_id, evento_tipo, email_comprador, payload })
//           → resolve (evento novo) | rejeita { code: "23505" } (replay)
//        vincularLojaAoEvento(client, eventoId, lojaId)
//        aplicarStatusAssinatura(client, lojaId, { status, fim_periodo, ... })
//   - "@/lib/supabase/queries/lojas" → buscarLojaPorEmailDono(client, email) → loja | null
//   - "@/lib/utils/assinatura" → eventoParaStatus(eventoLogico, statusAtual)
//
//   `hotmart.ts` (validarHottok/extrairEventoId/mapearEventoHotmart/calcularFimPeriodo)
//   NÃO é mockado — é puro; o handler o usa de verdade. O env HOTMART_WEBHOOK_TOKEN
//   é setado no teste.
// =============================================================================

const HOTTOK = "segredo-webhook-de-teste";

// ---- mocks dos colaboradores de I/O -----------------------------------------
const registrarEventoWebhook = vi.fn();
const vincularLojaAoEvento = vi.fn();
const aplicarStatusAssinatura = vi.fn();
const buscarLojaPorEmailDono = vi.fn();
const createServiceClient = vi.fn(() => ({ __mock: "service-client" }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));
vi.mock("@/lib/supabase/queries/webhookHotmart", () => ({
  registrarEventoWebhook: (...a: unknown[]) => registrarEventoWebhook(...a),
  vincularLojaAoEvento: (...a: unknown[]) => vincularLojaAoEvento(...a),
  aplicarStatusAssinatura: (...a: unknown[]) => aplicarStatusAssinatura(...a),
}));
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaPorEmailDono: (...a: unknown[]) => buscarLojaPorEmailDono(...a),
}));

import { POST } from "./route";

const LOJA = {
  id: "loja-1",
  dono_id: "dono-1",
  assinatura_status: "trial",
  assinatura_fim_periodo: null,
};
const LOJA_SUSPENSA = { ...LOJA, id: "loja-susp", assinatura_status: "suspensa" };

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.irango.local/api/webhooks/hotmart", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function payloadCompra(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    event: "PURCHASE_APPROVED",
    data: { buyer: { email: "joao@x.com" }, purchase: { transaction: "HP1" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOTMART_WEBHOOK_TOKEN = HOTTOK;
  // por padrão: evento novo (INSERT ok), loja encontrada
  registrarEventoWebhook.mockResolvedValue(undefined);
  buscarLojaPorEmailDono.mockResolvedValue(LOJA);
  aplicarStatusAssinatura.mockResolvedValue(undefined);
  vincularLojaAoEvento.mockResolvedValue(undefined);
});

describe("POST webhook Hotmart — autenticidade (RN-A2)", () => {
  it("hottok INVÁLIDO → 401 e ZERO efeito (não registra evento, não toca loja)", async () => {
    const res = await POST(
      req(payloadCompra(), { "x-hotmart-hottok": "token-errado" }),
    );
    expect(res.status).toBe(401);
    expect(registrarEventoWebhook).not.toHaveBeenCalled();
    expect(aplicarStatusAssinatura).not.toHaveBeenCalled();
    expect(buscarLojaPorEmailDono).not.toHaveBeenCalled();
  });

  it("hottok AUSENTE → 401 e ZERO efeito", async () => {
    const res = await POST(req(payloadCompra())); // sem header nem hottok no body
    expect(res.status).toBe(401);
    expect(registrarEventoWebhook).not.toHaveBeenCalled();
    expect(aplicarStatusAssinatura).not.toHaveBeenCalled();
  });
});

describe("POST webhook Hotmart — idempotência e validação (RN-A1/A3)", () => {
  it("payload SEM evento_id → 400, nada gravado", async () => {
    const semId = { event: "PURCHASE_APPROVED", data: { buyer: { email: "j@x.com" } } };
    const res = await POST(req(semId, { "x-hotmart-hottok": HOTTOK }));
    expect(res.status).toBe(400);
    expect(registrarEventoWebhook).not.toHaveBeenCalled();
    expect(aplicarStatusAssinatura).not.toHaveBeenCalled();
  });

  it("REPLAY (registrarEventoWebhook rejeita 23505) → 200 no-op, NÃO reativa loja suspensa", async () => {
    // loja está suspensa; um replay JAMAIS pode reativá-la (requisito de segurança central)
    buscarLojaPorEmailDono.mockResolvedValue(LOJA_SUSPENSA);
    registrarEventoWebhook.mockRejectedValue({ code: "23505" });

    const res = await POST(req(payloadCompra(), { "x-hotmart-hottok": HOTTOK }));

    expect(res.status).toBe(200);
    // a prova de segurança: nenhum UPDATE de loja no replay
    expect(aplicarStatusAssinatura).not.toHaveBeenCalled();
  });
});

describe("POST webhook Hotmart — aplicação de efeito (RN-A4)", () => {
  it("compra aprovada (evento novo) → registra evento + UPDATE loja para 'ativa' + 200", async () => {
    const res = await POST(req(payloadCompra(), { "x-hotmart-hottok": HOTTOK }));

    expect(res.status).toBe(200);
    expect(registrarEventoWebhook).toHaveBeenCalledTimes(1);
    expect(aplicarStatusAssinatura).toHaveBeenCalledTimes(1);
    // 2º arg = lojaId; 3º arg = dados com status 'ativa' e fim_periodo definido
    const [, lojaId, dados] = aplicarStatusAssinatura.mock.calls[0];
    expect(lojaId).toBe(LOJA.id);
    expect(dados.status).toBe("ativa");
    expect(dados.fim_periodo).toBeInstanceOf(Date);
    // ORDEM: o evento é registrado ANTES de aplicar o efeito (trava de idempotência)
    expect(registrarEventoWebhook.mock.invocationCallOrder[0]).toBeLessThan(
      aplicarStatusAssinatura.mock.invocationCallOrder[0],
    );
  });

  it("PURCHASE_REFUNDED → UPDATE loja para 'suspensa' (corte) + 200", async () => {
    const res = await POST(
      req(payloadCompra({ id: "evt-ref", event: "PURCHASE_REFUNDED" }), {
        "x-hotmart-hottok": HOTTOK,
      }),
    );
    expect(res.status).toBe(200);
    expect(aplicarStatusAssinatura).toHaveBeenCalledTimes(1);
    const [, , dados] = aplicarStatusAssinatura.mock.calls[0];
    expect(dados.status).toBe("suspensa");
  });
});

describe("POST webhook Hotmart — comprador sem loja (reconciliação 059)", () => {
  it("email não pertence a nenhuma loja → registra evento, NÃO toca loja, 200", async () => {
    buscarLojaPorEmailDono.mockResolvedValue(null);

    const res = await POST(req(payloadCompra(), { "x-hotmart-hottok": HOTTOK }));

    expect(res.status).toBe(200);
    expect(registrarEventoWebhook).toHaveBeenCalledTimes(1);
    expect(aplicarStatusAssinatura).not.toHaveBeenCalled();
  });
});
