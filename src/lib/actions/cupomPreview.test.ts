// TDD RED-first (issue 073 — crítica): testes da nova validarCupomAction
// que expõe contrato { valido, desconto_preview, mensagem } para o wizard
// de checkout (Etapa 1). A action existente validarCupom (013) tem contrato
// diferente ({ valido, desconto } | { valido, motivo }) — não serve ao wizard.
//
// FRONTEIRA preview ↔ autoritativo: desconto_preview é UX only. A autoridade
// real de desconto é criarPedido (071) que recalcula sobre os preços do banco.
// Este arquivo testa APENAS a shape do retorno e o roteamento de mensagem.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

// --- Mocks de I/O externo ---
const fakeClient = { __fake: "service-client" };
const createServiceClient = vi.fn(() => fakeClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  buscarCupomPorCodigo: (...args: unknown[]) => buscarCupomPorCodigo(...args),
}));

// Import da action nova (ainda não existe → testes vermelhos agora)
import { validarCupomAction } from "./cupomPreview";

const LOJA_A = "11111111-1111-1111-1111-111111111111";

function cupomRow(over: Partial<Tables<"cupons">> = {}): Tables<"cupons"> {
  return {
    id: "00000000-0000-0000-0000-0000000000c1",
    loja_id: LOJA_A,
    codigo: "PROMO10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validarCupomAction (073 — preview wizard)", () => {
  // ── Contrato de shape ─────────────────────────────────────────────────────

  it("cupom válido percentual → { valido:true, desconto_preview, mensagem }", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    const r = await validarCupomAction(LOJA_A, "PROMO10", 5000);
    expect(r).toMatchObject({
      valido: true,
      desconto_preview: 500, // 10% de 5000
      mensagem: expect.any(String),
    });
  });

  it("retorna exatamente os campos { valido, desconto_preview, mensagem } — sem extras sensíveis", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    const r = await validarCupomAction(LOJA_A, "PROMO10", 5000);
    // Não vaza motivo interno, não vaza id/loja_id do cupom
    expect(Object.keys(r).sort()).toEqual(
      ["desconto_preview", "mensagem", "valido"].sort(),
    );
  });

  // ── RN-C1: desconto incide só no subtotal (nunca no frete) ───────────────

  it("RN-C1: desconto calculado sobre subtotal_preview, não inclui frete", async () => {
    // Subtotal = 4000, frete hipotético = 1000 (não passado à action)
    // Se frete fosse incluído: 10% de 5000 = 500. Correto = 10% de 4000 = 400.
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    const r = await validarCupomAction(LOJA_A, "PROMO10", 4000);
    expect(r.valido).toBe(true);
    expect(r.desconto_preview).toBe(400); // base = subtotal apenas
  });

  it("cupom fixo → desconto_preview = valor fixo (clampado ao subtotal)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(
      cupomRow({ tipo: "fixo", valor: 300 }),
    );
    const r = await validarCupomAction(LOJA_A, "PROMO10", 1000);
    expect(r).toMatchObject({ valido: true, desconto_preview: 300 });
  });

  it("cupom fixo maior que subtotal → desconto_preview clampado ao subtotal", async () => {
    buscarCupomPorCodigo.mockResolvedValue(
      cupomRow({ tipo: "fixo", valor: 2000 }),
    );
    const r = await validarCupomAction(LOJA_A, "PROMO10", 500);
    expect(r).toMatchObject({ valido: true, desconto_preview: 500 });
  });

  // ── Falhas que retornam valido:false ─────────────────────────────────────

  it("cupom inexistente → { valido:false, desconto_preview:0, mensagem } (anti-enumeração)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(null);
    const r = await validarCupomAction(LOJA_A, "NAOEXISTE", 5000);
    expect(r).toEqual({
      valido: false,
      desconto_preview: 0,
      mensagem: expect.any(String),
    });
    // Mensagem não deve vazar se cupom existe ou não
    expect(r.mensagem).not.toContain("não existe");
    expect(r.mensagem).not.toContain("inexistente");
  });

  it("cupom inativo → { valido:false, desconto_preview:0 } (anti-enumeração)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ ativo: false }));
    const r = await validarCupomAction(LOJA_A, "PROMO10", 5000);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
  });

  it("cupom expirado → { valido:false, desconto_preview:0 }", async () => {
    buscarCupomPorCodigo.mockResolvedValue(
      cupomRow({ expira_em: "2020-01-01T00:00:00.000Z" }),
    );
    const r = await validarCupomAction(LOJA_A, "PROMO10", 5000);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
  });

  it("cupom esgotado (usos_maximos atingido) → { valido:false, desconto_preview:0 }", async () => {
    buscarCupomPorCodigo.mockResolvedValue(
      cupomRow({ usos_maximos: 10, usos_contagem: 10 }),
    );
    const r = await validarCupomAction(LOJA_A, "PROMO10", 5000);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
  });

  it("subtotal abaixo do pedido_minimo → { valido:false, desconto_preview:0, mensagem com mínimo }", async () => {
    buscarCupomPorCodigo.mockResolvedValue(
      cupomRow({ pedido_minimo: 5000 }),
    );
    const r = await validarCupomAction(LOJA_A, "PROMO10", 4999);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
    // A mensagem PODE revelar o mínimo (é o único motivo revelável — seguranca.md §6)
    expect(r.mensagem.length).toBeGreaterThan(0);
  });

  // ── Validação de input (Zod rejeita ANTES do banco) ──────────────────────

  it("loja_id não-UUID → { valido:false, desconto_preview:0 } SEM tocar no banco", async () => {
    const r = await validarCupomAction("nao-uuid", "PROMO10", 5000);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("subtotal negativo → { valido:false, desconto_preview:0 } SEM tocar no banco", async () => {
    const r = await validarCupomAction(LOJA_A, "PROMO10", -1);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("subtotal NaN → { valido:false, desconto_preview:0 } SEM tocar no banco", async () => {
    const r = await validarCupomAction(LOJA_A, "PROMO10", NaN);
    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("código com espaço/caixa diferente → normaliza antes da busca", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    await validarCupomAction(LOJA_A, "  promo10 ", 5000);
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(
      fakeClient,
      LOJA_A,
      "PROMO10",
    );
  });

  // ── Segurança ─────────────────────────────────────────────────────────────

  it("escopa busca por (loja_id, codigo) via service_role (nunca SELECT público)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    await validarCupomAction(LOJA_A, "PROMO10", 5000);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(
      fakeClient,
      LOJA_A,
      "PROMO10",
    );
  });

  it("cupom de outra loja não casa (escopo loja_id) → valido:false", async () => {
    // buscarCupomPorCodigo escopado por LOJA_A não encontra cupom da loja B → null.
    // Código sem underscore para passar no regex [A-Z0-9]+ do schema.
    buscarCupomPorCodigo.mockResolvedValue(null);
    const r = await validarCupomAction(LOJA_A, "CUPOMLOJAБ", 9999);
    // Código com "Б" (cirílico) → Zod rejeita → banco não é chamado.
    // Usar código alfanumérico ASCII válido:
    buscarCupomPorCodigo.mockResolvedValue(null);
    const r2 = await validarCupomAction(LOJA_A, "SECRETOB", 9999);
    expect(r2).toMatchObject({ valido: false, desconto_preview: 0 });
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(
      fakeClient,
      LOJA_A,
      "SECRETOB",
    );
  });

  it("erro de banco → valido:false + log no servidor, sem vazar e.message", async () => {
    const erro = new Error("connection refused: credencial secreta XYZ");
    buscarCupomPorCodigo.mockRejectedValue(erro);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await validarCupomAction(LOJA_A, "PROMO10", 5000);

    expect(r).toMatchObject({ valido: false, desconto_preview: 0 });
    expect(spy).toHaveBeenCalledWith("[validarCupomAction]", erro);
    expect(JSON.stringify(r)).not.toContain("credencial");
    spy.mockRestore();
  });
});
