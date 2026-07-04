import { describe, it, expect } from "vitest";
import { transicaoPermitida, ehStatusTerminal, type StatusPedido } from "./transicaoStatus";

// Máquina de estados do status do pedido (RN-08, issue 033):
//   pendente → confirmado → em_preparo → saiu_entrega → entregue
//   cancelar permitido de: pendente | confirmado | em_preparo
//   entregue e cancelado são TERMINAIS
//   sem reversão, sem salto, não permanece no mesmo estado

const TODOS: StatusPedido[] = [
  "pendente",
  "confirmado",
  "em_preparo",
  "saiu_entrega",
  "entregue",
  "cancelado",
];

describe("transicaoPermitida (máquina de estados — função pura)", () => {
  describe("avanço linear permitido", () => {
    it("pendente → confirmado", () => {
      expect(transicaoPermitida("pendente", "confirmado")).toBe(true);
    });
    it("confirmado → em_preparo", () => {
      expect(transicaoPermitida("confirmado", "em_preparo")).toBe(true);
    });
    it("em_preparo → saiu_entrega", () => {
      expect(transicaoPermitida("em_preparo", "saiu_entrega")).toBe(true);
    });
    it("saiu_entrega → entregue", () => {
      expect(transicaoPermitida("saiu_entrega", "entregue")).toBe(true);
    });
  });

  describe("cancelamento permitido só de estados não-finais de logística", () => {
    it("pendente → cancelado", () => {
      expect(transicaoPermitida("pendente", "cancelado")).toBe(true);
    });
    it("confirmado → cancelado", () => {
      expect(transicaoPermitida("confirmado", "cancelado")).toBe(true);
    });
    it("em_preparo → cancelado", () => {
      expect(transicaoPermitida("em_preparo", "cancelado")).toBe(true);
    });
    it("saiu_entrega → cancelado é RECUSADO (já em rota — critério de aceite)", () => {
      expect(transicaoPermitida("saiu_entrega", "cancelado")).toBe(false);
    });
  });

  describe("saltos recusados (não pode pular etapa)", () => {
    it("pendente → entregue (salto — critério de aceite)", () => {
      expect(transicaoPermitida("pendente", "entregue")).toBe(false);
    });
    it("pendente → em_preparo", () => {
      expect(transicaoPermitida("pendente", "em_preparo")).toBe(false);
    });
    it("pendente → saiu_entrega", () => {
      expect(transicaoPermitida("pendente", "saiu_entrega")).toBe(false);
    });
    it("confirmado → saiu_entrega", () => {
      expect(transicaoPermitida("confirmado", "saiu_entrega")).toBe(false);
    });
    it("confirmado → entregue", () => {
      expect(transicaoPermitida("confirmado", "entregue")).toBe(false);
    });
  });

  describe("reversões recusadas (não pode voltar status)", () => {
    it("confirmado → pendente", () => {
      expect(transicaoPermitida("confirmado", "pendente")).toBe(false);
    });
    it("em_preparo → confirmado", () => {
      expect(transicaoPermitida("em_preparo", "confirmado")).toBe(false);
    });
    it("saiu_entrega → em_preparo", () => {
      expect(transicaoPermitida("saiu_entrega", "em_preparo")).toBe(false);
    });
    it("entregue → pendente é RECUSADO (critério de aceite)", () => {
      expect(transicaoPermitida("entregue", "pendente")).toBe(false);
    });
    it("entregue → saiu_entrega", () => {
      expect(transicaoPermitida("entregue", "saiu_entrega")).toBe(false);
    });
  });

  describe("estados terminais não têm saída", () => {
    it("entregue não transiciona para NENHUM outro estado", () => {
      for (const para of TODOS) {
        expect(transicaoPermitida("entregue", para)).toBe(false);
      }
    });
    it("cancelado não transiciona para NENHUM outro estado", () => {
      for (const para of TODOS) {
        expect(transicaoPermitida("cancelado", para)).toBe(false);
      }
    });
  });

  describe("no-op recusado (mesmo estado não é transição)", () => {
    it.each(TODOS)("%s → mesmo estado é recusado", (s) => {
      expect(transicaoPermitida(s, s)).toBe(false);
    });
  });
});

describe("ehStatusTerminal (predicado derivado do grafo — função pura)", () => {
  describe("terminais (sem saída no grafo) → true", () => {
    it("entregue é terminal", () => {
      expect(ehStatusTerminal("entregue")).toBe(true);
    });
    it("cancelado é terminal", () => {
      expect(ehStatusTerminal("cancelado")).toBe(true);
    });
  });

  describe("estados em andamento (com saída) → false", () => {
    it("pendente não é terminal", () => {
      expect(ehStatusTerminal("pendente")).toBe(false);
    });
    it("confirmado não é terminal", () => {
      expect(ehStatusTerminal("confirmado")).toBe(false);
    });
    it("em_preparo não é terminal", () => {
      expect(ehStatusTerminal("em_preparo")).toBe(false);
    });
    it("saiu_entrega não é terminal", () => {
      expect(ehStatusTerminal("saiu_entrega")).toBe(false);
    });
  });

  it("cobre exatamente os 2 terminais entre os 6 status", () => {
    const terminais = TODOS.filter((s) => ehStatusTerminal(s));
    expect(terminais).toEqual(["entregue", "cancelado"]);
  });

  it("status fora do enum NÃO é terminal (não encerra polling cedo)", () => {
    // drift de schema / dado legado via cast — guarda de defesa em profundidade
    expect(ehStatusTerminal("fantasma" as StatusPedido)).toBe(false);
  });

  it("status null (coluna ausente/drift do banco) NÃO é terminal", () => {
    // `TRANSICOES[null]` também é `undefined` — mesma guarda deve cobrir null,
    // não só string desconhecida. Bug plausível: usar `TRANSICOES[status] ?? []`
    // (como transicaoPermitida) trataria null como terminal (length 0 do []).
    expect(ehStatusTerminal(null as unknown as StatusPedido)).toBe(false);
  });

  it("status undefined (campo faltando no retorno do banco) NÃO é terminal", () => {
    expect(ehStatusTerminal(undefined as unknown as StatusPedido)).toBe(false);
  });

  it("string vazia NÃO é terminal", () => {
    expect(ehStatusTerminal("" as StatusPedido)).toBe(false);
  });
});
