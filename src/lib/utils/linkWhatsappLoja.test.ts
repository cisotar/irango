import { describe, it, expect } from "vitest";
import { linkWhatsappLoja } from "./linkWhatsappLoja";

describe("linkWhatsappLoja", () => {
  it("monta wa.me só com os dígitos e a mensagem codificada", () => {
    expect(linkWhatsappLoja("(11) 90000-0000", "Olá, loja & cia!")).toBe(
      "https://wa.me/11900000000?text=Ol%C3%A1%2C%20loja%20%26%20cia!",
    );
  });

  it.each([null, undefined, "", "   ", "sem-numero"])(
    "sem dígitos (%j) → null, sem link",
    (w) => {
      expect(linkWhatsappLoja(w, "x")).toBeNull();
    },
  );
});
