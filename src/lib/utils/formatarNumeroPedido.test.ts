import { describe, it, expect } from "vitest";
import { formatarNumeroPedido } from "./formatarNumeroPedido";

describe("formatarNumeroPedido", () => {
  it("pega os primeiros 8 chars e deixa maiúsculo", () => {
    expect(formatarNumeroPedido("abcdef12-3456-7890-abcd-ef1234567890")).toBe("ABCDEF12");
  });

  it("id com menos de 8 chars não quebra", () => {
    expect(formatarNumeroPedido("abc")).toBe("ABC");
  });

  it("id já maiúsculo permanece igual", () => {
    expect(formatarNumeroPedido("ABCDEF12xyz")).toBe("ABCDEF12");
  });

  it("nunca inclui o prefixo # (apresentação fica no caller)", () => {
    expect(formatarNumeroPedido("abcdef1234")).not.toContain("#");
  });
});
