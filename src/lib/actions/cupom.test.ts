import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

// --- Mocks de I/O externo (não testamos o banco aqui, e sim a ORQUESTRAÇÃO) ---
// service.ts é `server-only`: importá-lo num teste Vitest quebra. Mockamos.
const fakeClient = { __fake: "service-client" };
const createServiceClient = vi.fn(() => fakeClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  buscarCupomPorCodigo: (...args: unknown[]) => buscarCupomPorCodigo(...args),
}));

// 'use server' é só uma diretiva; importável em teste node.
import { validarCupom } from "./cupom";

// Cupom percentual 10%, ativo, ilimitado, sem mínimo, sem expiração.
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

const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validarCupom (Server Action — orquestração)", () => {
  it("caminho feliz: cupom 10% sobre 5000 → { valido:true, desconto:500 }", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: 5000 });
    expect(r).toEqual({ valido: true, desconto: 500 });
  });

  it("escopa a busca por (lojaId, codigo) via service_role", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: 5000 });
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(fakeClient, LOJA_A, "PROMO10");
  });

  it("ATAQUE: cupom de outra loja não casa (escopo lojaId) → invalido", async () => {
    // buscarCupomPorCodigo(svc, LOJA_A, "SECRETOB") → null porque o cupom é da B.
    buscarCupomPorCodigo.mockResolvedValue(null);
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "SECRETOB", subtotal: 9999 });
    expect(r).toEqual({ valido: false, motivo: "invalido" });
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(fakeClient, LOJA_A, "SECRETOB");
  });

  it("ATAQUE: cupom inexistente → invalido (mesmo motivo que inativo — anti-enumeração)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(null);
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "NAOEXISTE", subtotal: 5000 });
    expect(r).toEqual({ valido: false, motivo: "invalido" });
  });

  it("cupom inativo → invalido (indistinguível de inexistente)", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ ativo: false }));
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: 5000 });
    expect(r).toEqual({ valido: false, motivo: "invalido" });
  });

  it("código com espaço/caixa diferentes normaliza e busca PROMO10", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow());
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "  promo10 ", subtotal: 5000 });
    expect(r).toEqual({ valido: true, desconto: 500 });
    // O código deve chegar à query JÁ normalizado (trim + uppercase).
    expect(buscarCupomPorCodigo).toHaveBeenCalledWith(fakeClient, LOJA_A, "PROMO10");
  });

  it("subtotal abaixo do pedido_minimo → { valido:false, motivo:'pedido_minimo' }", async () => {
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 5000 }));
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: 4999 });
    expect(r).toEqual({ valido: false, motivo: "pedido_minimo" });
  });

  it("PREVIEW: subtotal mentido alto fura pedido_minimo no preview (013 APROVA — 014 é a autoridade)", async () => {
    // Documentação executável da fronteira: a 013 confia no subtotal recebido
    // (preview de UX). A barreira real do dinheiro é a 014, que re-deriva o
    // subtotal dos itens reais. Aqui a 013 deve aprovar e calcular sobre o
    // subtotal mentido — provando que NÃO é autoridade de valor.
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ pedido_minimo: 10000 }));
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: 100000 });
    expect(r).toEqual({ valido: true, desconto: 10000 }); // 10% de 100000
  });

  it("ATAQUE: subtotal negativo → invalido SEM tocar no banco (Zod rejeita)", async () => {
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: -1 });
    expect(r).toEqual({ valido: false, motivo: "invalido" });
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("ATAQUE: subtotal NaN → invalido SEM tocar no banco", async () => {
    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: NaN });
    expect(r).toEqual({ valido: false, motivo: "invalido" });
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("ATAQUE: lojaId não-UUID → invalido SEM tocar no banco", async () => {
    const r = await validarCupom({ lojaId: "não-uuid", codigo: "PROMO10", subtotal: 5000 });
    expect(r).toEqual({ valido: false, motivo: "invalido" });
    expect(buscarCupomPorCodigo).not.toHaveBeenCalled();
  });

  it("erro de banco → invalido + log [validarCupom], sem vazar e.message", async () => {
    const erro = new Error("connection refused: senha postgres XYZ");
    buscarCupomPorCodigo.mockRejectedValue(erro);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await validarCupom({ lojaId: LOJA_A, codigo: "PROMO10", subtotal: 5000 });

    expect(r).toEqual({ valido: false, motivo: "invalido" });
    // Logou no servidor com a tag do módulo (auditável), mas o retorno ao
    // cliente não carrega a mensagem do erro.
    expect(spy).toHaveBeenCalledWith("[validarCupom]", erro);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });
});
