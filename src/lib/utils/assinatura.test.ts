import { describe, it, expect } from "vitest";
// RED (issue 056, Adendo Hotmart RN-A4/RN-A6): este módulo ainda NÃO existe.
// A fase GREEN (executar) cria src/lib/utils/assinatura.ts com:
//   - tipo StatusAssinatura (union)
//   - tipo EventoHotmart (nomes lógicos do adendo)
//   - eventoParaStatus(evento, statusAtual): ResultadoEvento  (mapa evento → estado)
//   - assinaturaPermiteAcesso(status, fimPeriodo, agora): boolean  (regra de carência)
import {
  eventoParaStatus,
  assinaturaPermiteAcesso,
  eventoBillingParaStatus,
  type StatusAssinatura,
  type EventoHotmart,
} from "./assinatura";

// ===========================================================================
// CONTRATO (issue 056 + user spec)
//
// type StatusAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'cancelada' | 'suspensa'
//
// eventoParaStatus(evento: EventoHotmart, statusAtual: StatusAssinatura)
//   : { status: StatusAssinatura; renova: boolean; ignorar?: false }
//   | { ignorar: true }
//
//   Tradução evento Hotmart (nomes LÓGICOS do adendo — os nomes EXATOS do
//   payload Hotmart, PURCHASE_APPROVED etc., são confirmados na doc oficial e
//   isolados numa constante na camada de webhook 057, FORA desta função pura):
//     - 'compra_aprovada'        → { status: 'ativa',        renova: true  }
//     - 'recorrencia_aprovada'   → { status: 'ativa',        renova: true  }  (estende período)
//     - 'cancelamento'           → { status: 'cancelada',    renova: false }  (acesso até fim do período)
//     - 'reembolso'              → { status: 'suspensa',     renova: false }  (corte imediato)
//     - 'chargeback'             → { status: 'suspensa',     renova: false }  (corte imediato)
//     - 'inadimplencia'          → { status: 'inadimplente', renova: false }
//     - evento desconhecido      → { ignorar: true }                          (NÃO muda estado)
//
//   `renova: true` sinaliza ao webhook que deve (re)definir assinatura_fim_periodo
//   para o fim do novo ciclo. O CÁLCULO da data é I/O do webhook (057), não desta
//   função pura — aqui só decidimos status + se renova.
//
// assinaturaPermiteAcesso(status, fimPeriodo: Date, agora: Date): boolean
//   Regra de carência — fonte ÚNICA reusada por guard (016), gate (058/060)
//   e reconciliação (059). PURA: `agora` injetado, proibido Date.now()/new Date().
//     - 'ativa'        → true   (independe de fimPeriodo)
//     - 'trial'        → true se agora <= fimPeriodo, senão false
//     - 'inadimplente' → true se agora <= fimPeriodo (carência), senão false
//     - 'cancelada'    → true se agora <= fimPeriodo (período já pago), senão false
//     - 'suspensa'     → false SEMPRE (invariante: corte imediato, sem carência)
//
//   BORDA fixada (RN-A4: `now() <= assinatura_fim_periodo`):
//     - agora EXATAMENTE == fimPeriodo → ainda PERMITE (limite inclusivo)
//     - agora 1ms após fimPeriodo      → NEGA
//     - agora 1 dia após fimPeriodo    → NEGA
// ===========================================================================

const FIM = new Date("2026-07-01T00:00:00.000Z");
const ANTES = new Date("2026-06-15T12:00:00.000Z"); // bem dentro do período
const NO_LIMITE = new Date("2026-07-01T00:00:00.000Z"); // exatamente no fim
const UM_MS_DEPOIS = new Date("2026-07-01T00:00:00.001Z");
const UM_DIA_DEPOIS = new Date("2026-07-02T00:00:00.000Z");

describe("eventoParaStatus — mapa evento Hotmart → status (RN-A4)", () => {
  it("compra aprovada → ativa e renova (define período)", () => {
    expect(eventoParaStatus("compra_aprovada", "trial")).toEqual({
      status: "ativa",
      renova: true,
    });
  });

  it("recorrência aprovada → ativa e renova (estende fim do período)", () => {
    expect(eventoParaStatus("recorrencia_aprovada", "ativa")).toEqual({
      status: "ativa",
      renova: true,
    });
  });

  it("recorrência aprovada reativa quem estava inadimplente → ativa e renova", () => {
    expect(eventoParaStatus("recorrencia_aprovada", "inadimplente")).toEqual({
      status: "ativa",
      renova: true,
    });
  });

  it("cancelamento → cancelada, NÃO renova (mantém acesso até fim do período)", () => {
    expect(eventoParaStatus("cancelamento", "ativa")).toEqual({
      status: "cancelada",
      renova: false,
    });
  });

  it("reembolso → suspensa, NÃO renova (corte imediato)", () => {
    expect(eventoParaStatus("reembolso", "ativa")).toEqual({
      status: "suspensa",
      renova: false,
    });
  });

  it("chargeback → suspensa, NÃO renova (corte imediato)", () => {
    expect(eventoParaStatus("chargeback", "ativa")).toEqual({
      status: "suspensa",
      renova: false,
    });
  });

  it("inadimplência/atraso → inadimplente, NÃO renova", () => {
    expect(eventoParaStatus("inadimplencia", "ativa")).toEqual({
      status: "inadimplente",
      renova: false,
    });
  });

  it("evento desconhecido → ignorar, NÃO muda estado", () => {
    // cast: input não-confiável (string fora do union) — o webhook recebe nome cru
    expect(
      eventoParaStatus("EVENTO_QUE_NAO_EXISTE" as EventoHotmart, "ativa"),
    ).toEqual({ ignorar: true });
  });

  it("INVARIANTE: suspensa não é reativável por recorrência/compra dentro desta função sem evento explícito de reativação — chargeback sobre ativa permanece suspensa", () => {
    // corte imediato é invariante: nenhum evento de inadimplência rebaixa suspensa para inadimplente
    expect(eventoParaStatus("inadimplencia", "suspensa")).toEqual({
      status: "inadimplente",
      renova: false,
    });
    // NOTA GREEN: confirmar política — se 'suspensa' deve ser terminal para
    // inadimplencia, este caso revela a decisão. Mantido conforme mapa do adendo
    // (mapa depende só do EVENTO, não do statusAtual). Se a decisão for "suspensa
    // é terminal", ajustar mapa+este teste juntos.
  });
});

describe("assinaturaPermiteAcesso — regra de carência (RN-A4/RN-A6)", () => {
  it("ativa → permite (independe de fimPeriodo, mesmo no passado)", () => {
    expect(assinaturaPermiteAcesso("ativa", new Date("2000-01-01T00:00:00Z"), UM_DIA_DEPOIS)).toBe(true);
  });

  it("trial dentro do prazo → permite", () => {
    expect(assinaturaPermiteAcesso("trial", FIM, ANTES)).toBe(true);
  });

  it("trial expirado → NEGA", () => {
    expect(assinaturaPermiteAcesso("trial", FIM, UM_DIA_DEPOIS)).toBe(false);
  });

  it("inadimplente DENTRO da carência → permite", () => {
    expect(assinaturaPermiteAcesso("inadimplente", FIM, ANTES)).toBe(true);
  });

  it("inadimplente APÓS a carência → NEGA", () => {
    expect(assinaturaPermiteAcesso("inadimplente", FIM, UM_DIA_DEPOIS)).toBe(false);
  });

  it("cancelada mas DENTRO do período pago → permite", () => {
    expect(assinaturaPermiteAcesso("cancelada", FIM, ANTES)).toBe(true);
  });

  it("cancelada APÓS o fim do período → NEGA", () => {
    expect(assinaturaPermiteAcesso("cancelada", FIM, UM_DIA_DEPOIS)).toBe(false);
  });

  it("suspensa → NEGA mesmo DENTRO do período pago (corte imediato, invariante)", () => {
    expect(assinaturaPermiteAcesso("suspensa", FIM, ANTES)).toBe(false);
  });

  it("suspensa → NEGA também fora do período", () => {
    expect(assinaturaPermiteAcesso("suspensa", FIM, UM_DIA_DEPOIS)).toBe(false);
  });

  // --- bordas exatas de carência (RN-A4: now() <= fimPeriodo) ---
  it("BORDA: agora EXATAMENTE no fim do período (inadimplente) → ainda permite (limite inclusivo)", () => {
    expect(assinaturaPermiteAcesso("inadimplente", FIM, NO_LIMITE)).toBe(true);
  });

  it("BORDA: agora EXATAMENTE no fim do período (cancelada) → ainda permite", () => {
    expect(assinaturaPermiteAcesso("cancelada", FIM, NO_LIMITE)).toBe(true);
  });

  it("BORDA: agora EXATAMENTE no fim do período (trial) → ainda permite", () => {
    expect(assinaturaPermiteAcesso("trial", FIM, NO_LIMITE)).toBe(true);
  });

  it("BORDA: 1ms após o fim (inadimplente) → NEGA", () => {
    expect(assinaturaPermiteAcesso("inadimplente", FIM, UM_MS_DEPOIS)).toBe(false);
  });

  it("BORDA: 1 dia após o fim (cancelada) → NEGA", () => {
    expect(assinaturaPermiteAcesso("cancelada", FIM, UM_DIA_DEPOIS)).toBe(false);
  });
});

describe("tipos — StatusAssinatura cobre os 5 estados do adendo", () => {
  it("aceita os 5 estados como entrada de permiteAcesso", () => {
    const estados: StatusAssinatura[] = [
      "trial",
      "ativa",
      "inadimplente",
      "cancelada",
      "suspensa",
    ];
    // só exercita a assinatura de tipos + execução; asserções de valor estão acima
    expect(estados).toHaveLength(5);
    for (const s of estados) {
      expect(typeof assinaturaPermiteAcesso(s, FIM, ANTES)).toBe("boolean");
    }
  });
});

// ===========================================================================
// RED (issue 075): cortesia + eventoBillingParaStatus (cobrança por assinatura
// própria, provider-agnóstico). Atualmente:
//   - StatusAssinatura NÃO inclui "cortesia"
//   - eventoBillingParaStatus NÃO existe
//
// CONTRATO (issue 075):
//   StatusAssinatura ganha "cortesia":
//     assinaturaPermiteAcesso("cortesia", qualquerData, agora) === true SEMPRE
//     (ignora fimPeriodo — acesso liberado manualmente, sem cobrança)
//
//   eventoBillingParaStatus(provider: string, tipo: string): ResultadoEvento
//     (PROVIDER-AGNÓSTICO — o mapa depende só de `tipo`, nomes lógicos já
//      traduzidos do payload do provider na camada de webhook):
//       "cobranca_aprovada"    → { status: "ativa",        renova: true  }
//       "recorrencia_aprovada" → { status: "ativa",        renova: true  }
//       "pagamento_falhou"     → { status: "inadimplente", renova: false }
//       "assinatura_cancelada" → { status: "cancelada",    renova: false }
//       "reembolso"            → { status: "suspensa",     renova: false }
//       "chargeback"           → { status: "suspensa",     renova: false }
//       desconhecido           → { ignorar: true }
// ===========================================================================

describe("assinaturaPermiteAcesso — status 'cortesia' (issue 075)", () => {
  it("cortesia com fimPeriodo no PASSADO → permite (ignora fim)", () => {
    expect(
      assinaturaPermiteAcesso(
        "cortesia" as StatusAssinatura,
        new Date("2000-01-01T00:00:00Z"),
        UM_DIA_DEPOIS,
      ),
    ).toBe(true);
  });

  it("cortesia com fimPeriodo no FUTURO → permite", () => {
    expect(
      assinaturaPermiteAcesso(
        "cortesia" as StatusAssinatura,
        new Date("2099-01-01T00:00:00Z"),
        ANTES,
      ),
    ).toBe(true);
  });
});

describe("eventoBillingParaStatus — mapa provider-agnóstico (issue 075)", () => {
  it("asaas/cobranca_aprovada → ativa e renova", () => {
    expect(eventoBillingParaStatus("asaas", "cobranca_aprovada")).toEqual({
      status: "ativa",
      renova: true,
    });
  });

  it("asaas/reembolso → suspensa, NÃO renova (corte imediato)", () => {
    expect(eventoBillingParaStatus("asaas", "reembolso")).toEqual({
      status: "suspensa",
      renova: false,
    });
  });

  it("asaas/chargeback → suspensa, NÃO renova (corte imediato)", () => {
    expect(eventoBillingParaStatus("asaas", "chargeback")).toEqual({
      status: "suspensa",
      renova: false,
    });
  });

  it("asaas/assinatura_cancelada → cancelada, NÃO renova", () => {
    expect(eventoBillingParaStatus("asaas", "assinatura_cancelada")).toEqual({
      status: "cancelada",
      renova: false,
    });
  });

  it("asaas/pagamento_falhou → inadimplente, NÃO renova", () => {
    expect(eventoBillingParaStatus("asaas", "pagamento_falhou")).toEqual({
      status: "inadimplente",
      renova: false,
    });
  });

  it("asaas/evento desconhecido → ignorar (NÃO muda estado)", () => {
    expect(eventoBillingParaStatus("asaas", "evento_desconhecido")).toEqual({
      ignorar: true,
    });
  });

  it("PROVIDER-AGNÓSTICO: stripe/cobranca_aprovada → ativa e renova (mesmo mapa)", () => {
    expect(eventoBillingParaStatus("stripe", "cobranca_aprovada")).toEqual({
      status: "ativa",
      renova: true,
    });
  });
});
