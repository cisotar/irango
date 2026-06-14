import { describe, it, expect } from "vitest";
// =============================================================================
// Fase RED (TDD) — issue 057 (crítica: SIM). Módulo de ADAPTAÇÃO do contrato
// externo Hotmart. Funções PURAS, sem I/O, 100% testáveis. A fase GREEN
// (executar) escreve `src/lib/utils/hotmart.ts` — hoje é STUB que `throw` em
// cada corpo, então estas asserções caem VERMELHAS (falha de asserção, NÃO de
// import — a suite compila).
//
// CONTRATO (Plano Técnico §Arquivos / §Decisões D1-D3):
//
//   validarHottok(recebido: string|null, esperado: string|undefined): boolean
//     - Comparação TEMPO-CONSTANTE (crypto.timingSafeEqual + guarda de comprimento).
//     - igual → true; token errado → false; ausente (null/undefined) → false;
//       comprimento diferente → false SEM throw; esperado ausente → false.
//     - NUNCA usar `===` (vaza timing); NUNCA lançar exceção por tamanho.
//
//   extrairEventoId(payload: unknown): string | null
//     - primário `payload.id`; fallback determinístico `${transaction}:${event}`;
//       nenhum dos dois → null (handler responde 400 — sem id não há idempotência).
//
//   mapearEventoHotmart(nomeExterno: string): EventoLogico | null
//     - PURCHASE_APPROVED / PURCHASE_COMPLETE      → 'compra_aprovada'
//     - SUBSCRIPTION_CANCELLATION                  → 'cancelamento'
//     - PURCHASE_REFUNDED                          → 'reembolso'
//     - PURCHASE_CHARGEBACK                        → 'chargeback'
//     - PURCHASE_DELAYED / PURCHASE_OUT_OF_SHOPPING_CART_DELAYED... → 'inadimplencia'
//     - recorrência aprovada                       → 'recorrencia_aprovada'
//     - desconhecido                               → null  (handler ignora, 2xx)
//     - TODO GREEN: confirmar nomes EXATOS na doc oficial Hotmart.
//
//   calcularFimPeriodo(payloadFim: unknown, agora: Date): Date
//     - usa a data de próxima cobrança vinda da Hotmart se presente/válida;
//       senão fallback `agora + 30 dias`. PURA: `agora` injetado.
// =============================================================================
import {
  validarHottok,
  extrairEventoId,
  mapearEventoHotmart,
  calcularFimPeriodo,
} from "./hotmart";

const SEGREDO = "hottok-secreto-da-loja-xyz";

describe("validarHottok — comparação tempo-constante (D1, RN-A2)", () => {
  it("token recebido IGUAL ao esperado → true", () => {
    expect(validarHottok(SEGREDO, SEGREDO)).toBe(true);
  });

  it("token recebido DIFERENTE (mesmo comprimento) → false", () => {
    const errado = "hottok-secreto-da-loja-XXX"; // mesmo length, conteúdo distinto
    expect(errado.length).toBe(SEGREDO.length); // garante que testamos o caminho do conteúdo
    expect(validarHottok(errado, SEGREDO)).toBe(false);
  });

  it("token de COMPRIMENTO DIFERENTE → false SEM lançar (timingSafeEqual exige buffers de igual tamanho)", () => {
    expect(() => validarHottok("curto", SEGREDO)).not.toThrow();
    expect(validarHottok("curto", SEGREDO)).toBe(false);
    expect(validarHottok(SEGREDO + "-a-mais", SEGREDO)).toBe(false);
  });

  it("token recebido AUSENTE (null) → false", () => {
    expect(validarHottok(null, SEGREDO)).toBe(false);
  });

  it("segredo esperado AUSENTE (env não configurado) → false (nunca autoriza sem segredo)", () => {
    expect(validarHottok(SEGREDO, undefined)).toBe(false);
    expect(validarHottok(null, undefined)).toBe(false);
  });

  it("string vazia recebida contra segredo real → false", () => {
    expect(validarHottok("", SEGREDO)).toBe(false);
  });
});

describe("extrairEventoId — idempotência (D2)", () => {
  it("usa payload.id quando presente", () => {
    expect(extrairEventoId({ id: "evt-canonico-1", event: "PURCHASE_APPROVED" })).toBe(
      "evt-canonico-1",
    );
  });

  it("fallback determinístico `${transaction}:${event}` quando id ausente", () => {
    expect(
      extrairEventoId({ event: "PURCHASE_APPROVED", data: { purchase: { transaction: "HP123" } } }),
    ).toBe("HP123:PURCHASE_APPROVED");
  });

  it("payload sem id e sem transaction → null (handler responde 400)", () => {
    expect(extrairEventoId({ event: "PURCHASE_APPROVED" })).toBeNull();
  });

  it("payload vazio / não-objeto → null (não lança)", () => {
    expect(extrairEventoId({})).toBeNull();
    expect(extrairEventoId(null)).toBeNull();
    expect(extrairEventoId("nao-e-objeto")).toBeNull();
  });
});

describe("mapearEventoHotmart — nome externo → nome lógico (D-mapa, RN-A3)", () => {
  it("PURCHASE_APPROVED → compra_aprovada", () => {
    expect(mapearEventoHotmart("PURCHASE_APPROVED")).toBe("compra_aprovada");
  });

  it("PURCHASE_COMPLETE → compra_aprovada", () => {
    expect(mapearEventoHotmart("PURCHASE_COMPLETE")).toBe("compra_aprovada");
  });

  it("SUBSCRIPTION_CANCELLATION → cancelamento", () => {
    expect(mapearEventoHotmart("SUBSCRIPTION_CANCELLATION")).toBe("cancelamento");
  });

  it("PURCHASE_REFUNDED → reembolso (corte)", () => {
    expect(mapearEventoHotmart("PURCHASE_REFUNDED")).toBe("reembolso");
  });

  it("PURCHASE_CHARGEBACK → chargeback (corte)", () => {
    expect(mapearEventoHotmart("PURCHASE_CHARGEBACK")).toBe("chargeback");
  });

  it("PURCHASE_DELAYED → inadimplencia", () => {
    expect(mapearEventoHotmart("PURCHASE_DELAYED")).toBe("inadimplencia");
  });

  it("evento desconhecido → null (handler ignora, 2xx — NÃO muda estado)", () => {
    expect(mapearEventoHotmart("PURCHASE_PROTEST")).toBeNull();
    expect(mapearEventoHotmart("EVENTO_INVENTADO")).toBeNull();
    expect(mapearEventoHotmart("")).toBeNull();
  });
});

describe("calcularFimPeriodo — data Hotmart ou fallback +30d (D3, PURA)", () => {
  const AGORA = new Date("2026-06-14T12:00:00.000Z");

  it("usa a data de próxima cobrança da Hotmart quando presente e válida", () => {
    const proximaCobranca = new Date("2026-07-14T00:00:00.000Z");
    const r = calcularFimPeriodo(proximaCobranca.getTime(), AGORA);
    expect(r.getTime()).toBe(proximaCobranca.getTime());
  });

  it("payload sem data → fallback agora + 30 dias", () => {
    const esperado = new Date("2026-07-14T12:00:00.000Z"); // 14 jun + 30d
    expect(calcularFimPeriodo(undefined, AGORA).getTime()).toBe(esperado.getTime());
    expect(calcularFimPeriodo(null, AGORA).getTime()).toBe(esperado.getTime());
  });

  it("data inválida (não parseável) → fallback +30d, nunca data no passado/Invalid Date", () => {
    const r = calcularFimPeriodo("nao-e-data", AGORA);
    expect(Number.isNaN(r.getTime())).toBe(false);
    expect(r.getTime()).toBe(new Date("2026-07-14T12:00:00.000Z").getTime());
  });

  it("PURA: `agora` injetado é a única fonte de tempo (sem Date.now)", () => {
    const outroAgora = new Date("2030-01-01T00:00:00.000Z");
    const r = calcularFimPeriodo(undefined, outroAgora);
    expect(r.getTime()).toBe(new Date("2030-01-31T00:00:00.000Z").getTime());
  });
});
