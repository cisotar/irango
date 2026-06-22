import { describe, it, expect } from "vitest";
// =============================================================================
// Fase RED (TDD) — issue 076 (crítica: SIM). Adapter do provider de billing
// Asaas. Funções PURAS, sem I/O, 100% testáveis (espelha hotmart.test.ts). A
// fase GREEN (executar) escreve `src/lib/billing/providers/asaas.ts`; hoje o
// arquivo NÃO EXISTE → falha de IMPORT (toda a suite vermelha). Quando GREEN
// criar o módulo como stub que `throw` em cada corpo, estas asserções caem
// vermelhas por ASSERÇÃO. Ambos os estados são RED válido antes do GREEN.
//
// CONTRATO (Plano Técnico §Contratos de Dados / §Mapa de eventos / D3):
//
//   validarTokenAsaas(token: string | null, segredo: string): boolean
//     - Token estático no header `asaas-access-token` comparado contra o
//       segredo via crypto.timingSafeEqual (D3). igual → true; errado → false;
//       null → false; comprimento diferente → false SEM throw; segredo vazio →
//       false (nunca autoriza às cegas). NUNCA `===` (vaza timing).
//     > Nome `validarTokenAsaas`/`validarAssinaturaWebhook` — ver contrato GREEN.
//
//   mapearEventoAsaas(tipoExterno: string): EventoBilling | null
//     (mapa do Plano Técnico, tabela §Mapa de eventos externos Asaas)
//     - PAYMENT_CONFIRMED              → cobranca_aprovada
//     - PAYMENT_RECEIVED               → recorrencia_aprovada  (plano linha 139)
//     - PAYMENT_OVERDUE                → pagamento_falhou
//     - PAYMENT_DELETED                → assinatura_cancelada
//     - PAYMENT_REFUNDED               → reembolso
//     - PAYMENT_PARTIALLY_REFUNDED     → reembolso
//     - PAYMENT_CHARGEBACK_REQUESTED   → chargeback   (nome externo Asaas real)
//     - desconhecido / intermediário / "" → null  (077 loga, 2xx, não muda estado)
//
//   calcularFimPeriodoBilling(proximaCobranca: unknown, agora: Date): Date
//     - data ISO válida → Date correspondente (>= agora no caso feliz);
//       null/undefined/inválida → fallback `agora + 30 dias`. PURA: `agora`
//       injetado, nunca Date.now, nunca Invalid Date / data no passado.
// =============================================================================
import {
  validarTokenAsaas,
  mapearEventoAsaas,
  calcularFimPeriodoBilling,
} from "./asaas";

const SEGREDO = "asaas-webhook-secret-loja-xyz";

describe("validarTokenAsaas — comparação tempo-constante (D3, §9)", () => {
  it("token recebido IGUAL ao segredo → true", () => {
    expect(validarTokenAsaas(SEGREDO, SEGREDO)).toBe(true);
  });

  it("token DIFERENTE (mesmo comprimento) → false", () => {
    const errado = "asaas-webhook-secret-loja-XXX"; // mesmo length, conteúdo distinto
    expect(errado.length).toBe(SEGREDO.length); // garante o caminho do conteúdo
    expect(validarTokenAsaas(errado, SEGREDO)).toBe(false);
  });

  it("token de COMPRIMENTO DIFERENTE → false SEM lançar (timingSafeEqual exige buffers de igual tamanho)", () => {
    expect(() => validarTokenAsaas("curto", SEGREDO)).not.toThrow();
    expect(validarTokenAsaas("curto", SEGREDO)).toBe(false);
    expect(validarTokenAsaas(SEGREDO + "-a-mais", SEGREDO)).toBe(false);
  });

  it("token AUSENTE (null) → false", () => {
    expect(validarTokenAsaas(null, SEGREDO)).toBe(false);
  });

  it("segredo AUSENTE/vazio → false (nunca autoriza sem segredo)", () => {
    expect(validarTokenAsaas(SEGREDO, "")).toBe(false);
    expect(validarTokenAsaas(null, "")).toBe(false);
  });

  it("string vazia recebida contra segredo real → false", () => {
    expect(validarTokenAsaas("", SEGREDO)).toBe(false);
  });

  // Teste negativo de bypass: o adapter nunca deve aceitar token adulterado.
  it("BYPASS recusado: prefixo correto do segredo (truncado) → false", () => {
    expect(validarTokenAsaas(SEGREDO.slice(0, 5), SEGREDO)).toBe(false);
  });
});

describe("mapearEventoAsaas — nome externo Asaas → EventoBilling lógico (§Mapa de eventos)", () => {
  it("PAYMENT_CONFIRMED → cobranca_aprovada", () => {
    expect(mapearEventoAsaas("PAYMENT_CONFIRMED")).toBe("cobranca_aprovada");
  });

  it("PAYMENT_RECEIVED → recorrencia_aprovada (plano linha 139)", () => {
    expect(mapearEventoAsaas("PAYMENT_RECEIVED")).toBe("recorrencia_aprovada");
  });

  it("PAYMENT_OVERDUE → pagamento_falhou", () => {
    expect(mapearEventoAsaas("PAYMENT_OVERDUE")).toBe("pagamento_falhou");
  });

  it("PAYMENT_DELETED → assinatura_cancelada", () => {
    expect(mapearEventoAsaas("PAYMENT_DELETED")).toBe("assinatura_cancelada");
  });

  it("PAYMENT_REFUNDED → reembolso (corte, RN-8)", () => {
    expect(mapearEventoAsaas("PAYMENT_REFUNDED")).toBe("reembolso");
  });

  it("PAYMENT_PARTIALLY_REFUNDED → reembolso (conservador, corte)", () => {
    expect(mapearEventoAsaas("PAYMENT_PARTIALLY_REFUNDED")).toBe("reembolso");
  });

  it("PAYMENT_CHARGEBACK_REQUESTED → chargeback (corte, RN-8)", () => {
    expect(mapearEventoAsaas("PAYMENT_CHARGEBACK_REQUESTED")).toBe("chargeback");
  });

  it("evento intermediário / desconhecido / vazio → null (077 loga, 2xx, NÃO muda estado)", () => {
    expect(mapearEventoAsaas("PAYMENT_CREATED")).toBeNull();
    expect(mapearEventoAsaas("PAYMENT_UPDATED")).toBeNull();
    expect(mapearEventoAsaas("PAYMENT_AWAITING_RISK_ANALYSIS")).toBeNull();
    expect(mapearEventoAsaas("EVENTO_INVENTADO")).toBeNull();
    expect(mapearEventoAsaas("")).toBeNull();
  });
});

describe("calcularFimPeriodoBilling — data Asaas ou fallback +30d (PURA)", () => {
  const AGORA = new Date("2026-06-21T12:00:00.000Z");

  it("usa a data ISO de próxima cobrança quando presente e válida", () => {
    const proxima = "2026-07-21T00:00:00.000Z";
    const r = calcularFimPeriodoBilling(proxima, AGORA);
    expect(r.getTime()).toBe(new Date(proxima).getTime());
    expect(r.getTime()).toBeGreaterThanOrEqual(AGORA.getTime());
  });

  it("data ausente (undefined/null) → fallback agora + 30 dias", () => {
    const esperado = new Date("2026-07-21T12:00:00.000Z").getTime(); // 21 jun + 30d
    expect(calcularFimPeriodoBilling(undefined, AGORA).getTime()).toBe(esperado);
    expect(calcularFimPeriodoBilling(null, AGORA).getTime()).toBe(esperado);
  });

  it("data inválida (não parseável) → fallback +30d, nunca Invalid Date / passado", () => {
    const r = calcularFimPeriodoBilling("nao-e-data", AGORA);
    expect(Number.isNaN(r.getTime())).toBe(false);
    expect(r.getTime()).toBe(new Date("2026-07-21T12:00:00.000Z").getTime());
  });

  it("PURA: `agora` injetado é a única fonte de tempo (sem Date.now)", () => {
    const outroAgora = new Date("2030-01-01T00:00:00.000Z");
    const r = calcularFimPeriodoBilling(undefined, outroAgora);
    expect(r.getTime()).toBe(new Date("2030-01-31T00:00:00.000Z").getTime());
  });
});
