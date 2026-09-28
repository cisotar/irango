/**
 * Fase RED (TDD) — issue 329, RN-SC11 (spec
 * `specs/status-pedido-clicavel-e-latencia.md`, "Rótulo da etapa `saiu_entrega`
 * por modalidade").
 *
 * CONTRATO (GREEN): `rotuloStatusPedido(status, tipoEntrega): string` em
 * `src/lib/utils/rotulosPedido.ts`, ao lado de `ROTULO_TIPO_ENTREGA`. Fonte
 * única do rótulo de status no PAINEL (selo, `aria-label`, menu, `AcoesStatus`).
 * `tipoEntrega` só pesa em `saiu_entrega`: `"retirada"` → "Pronto para retirada";
 * qualquer outro valor (`"entrega"`, `null`, `""`, desconhecido) → "Saiu pra
 * entrega" (default seguro, mesmo contrato de `copyStatusConfirmacao`).
 *
 * Os demais rótulos são os do selo atual (`APARENCIA_STATUS` de
 * `TabelaPedidos.tsx`/`DetalhePedido.tsx`) — sem mudança visual.
 */

import { describe, it, expect } from "vitest";

import { rotuloStatusPedido } from "./rotulosPedido";
import { STATUS_VALIDOS } from "./transicaoStatus";

describe("rotuloStatusPedido — saiu_entrega por modalidade (RN-SC11)", () => {
  it("saiu_entrega + retirada → 'Pronto para retirada'", () => {
    expect(rotuloStatusPedido("saiu_entrega", "retirada")).toBe("Pronto para retirada");
  });

  it("saiu_entrega + entrega → 'Saiu pra entrega'", () => {
    expect(rotuloStatusPedido("saiu_entrega", "entrega")).toBe("Saiu pra entrega");
  });

  it.each([null, "", "drone", "Retirada"])(
    "saiu_entrega + tipoEntrega %j → 'Saiu pra entrega' (default seguro)",
    (tipo) => {
      expect(rotuloStatusPedido("saiu_entrega", tipo)).toBe("Saiu pra entrega");
    },
  );
});

describe("rotuloStatusPedido — demais status (rótulo atual do selo do painel)", () => {
  const ESPERADO = {
    pendente: "Pendente",
    confirmado: "Confirmado",
    em_preparo: "Em preparo",
    entregue: "Entregue",
    cancelado: "Cancelado",
  } as const;

  it.each(Object.entries(ESPERADO))("%s → %s, em qualquer modalidade", (status, rotulo) => {
    for (const tipo of ["entrega", "retirada", null]) {
      expect(rotuloStatusPedido(status as keyof typeof ESPERADO, tipo)).toBe(rotulo);
    }
  });

  it("nenhum rótulo de pedido de retirada diz que ele 'saiu' para entrega", () => {
    for (const status of STATUS_VALIDOS) {
      expect(rotuloStatusPedido(status, "retirada").toLowerCase()).not.toContain("saiu");
    }
  });
});
