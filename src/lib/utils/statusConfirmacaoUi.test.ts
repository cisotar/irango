import { describe, expect, it } from "vitest";

import { copyStatusConfirmacao } from "@/lib/utils/statusConfirmacaoUi";
import { STATUS_VALIDOS } from "@/lib/utils/transicaoStatus";

describe("copyStatusConfirmacao", () => {
  it("retorna título e mensagem exatos da tabela do spec para os 6 status", () => {
    expect(copyStatusConfirmacao("pendente", "entrega")).toEqual({
      titulo: "Pedido recebido",
      mensagem: "Aguardando a loja confirmar seu pedido.",
    });
    expect(copyStatusConfirmacao("confirmado", "entrega")).toEqual({
      titulo: "Pedido confirmado",
      mensagem: "A loja confirmou! Logo começa o preparo.",
    });
    expect(copyStatusConfirmacao("em_preparo", "entrega")).toEqual({
      titulo: "Em preparo",
      mensagem: "Seu pedido está sendo preparado.",
    });
    expect(copyStatusConfirmacao("entregue", "entrega")).toEqual({
      titulo: "Pedido entregue",
      mensagem: "Pedido entregue. Bom apetite!",
    });
    expect(copyStatusConfirmacao("cancelado", "entrega")).toEqual({
      titulo: "Pedido cancelado",
      mensagem: "Este pedido foi cancelado pela loja.",
    });
  });

  it("cobre todos os STATUS_VALIDOS sem cair no fallback", () => {
    for (const status of STATUS_VALIDOS) {
      const copy = copyStatusConfirmacao(status, "entrega");
      expect(copy.titulo).not.toBe("Pedido em andamento");
      expect(copy.titulo.length).toBeGreaterThan(0);
      expect(copy.mensagem.length).toBeGreaterThan(0);
    }
  });

  describe("saiu_entrega adapta por tipo_entrega", () => {
    it("retirada menciona retirada", () => {
      const copy = copyStatusConfirmacao("saiu_entrega", "retirada");
      expect(copy.titulo).toBe("Saiu para entrega");
      expect(copy.mensagem).toBe("Seu pedido está pronto para retirada.");
      expect(copy.mensagem.toLowerCase()).toContain("retirada");
    });

    it("entrega menciona 'a caminho'", () => {
      const copy = copyStatusConfirmacao("saiu_entrega", "entrega");
      expect(copy.mensagem).toBe("Seu pedido está a caminho.");
      expect(copy.mensagem.toLowerCase()).toContain("a caminho");
    });

    it("tipo_entrega null cai no default 'a caminho'", () => {
      expect(copyStatusConfirmacao("saiu_entrega", null).mensagem).toBe(
        "Seu pedido está a caminho.",
      );
    });

    it("tipo_entrega desconhecido/vazio cai no default 'a caminho'", () => {
      expect(copyStatusConfirmacao("saiu_entrega", "").mensagem).toBe(
        "Seu pedido está a caminho.",
      );
      expect(copyStatusConfirmacao("saiu_entrega", "drone").mensagem).toBe(
        "Seu pedido está a caminho.",
      );
    });
  });

  it("tipo_entrega é ignorado fora de saiu_entrega", () => {
    expect(copyStatusConfirmacao("pendente", "retirada")).toEqual(
      copyStatusConfirmacao("pendente", "entrega"),
    );
  });

  describe("fallback seguro (sem throw)", () => {
    it("status fora do enum retorna copy genérica", () => {
      expect(copyStatusConfirmacao("status_legado", "entrega")).toEqual({
        titulo: "Pedido em andamento",
        mensagem: "Acompanhe o status do seu pedido.",
      });
    });

    it("não lança para status vazio nem tipo_entrega null", () => {
      expect(() => copyStatusConfirmacao("", null)).not.toThrow();
    });

    it("nomes herdados de Object.prototype não escapam para o objeto do mapa (poluição de protótipo)", () => {
      for (const status of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
        const copy = copyStatusConfirmacao(status, "entrega");
        expect(copy).toEqual({
          titulo: "Pedido em andamento",
          mensagem: "Acompanhe o status do seu pedido.",
        });
      }
    });
  });
});
