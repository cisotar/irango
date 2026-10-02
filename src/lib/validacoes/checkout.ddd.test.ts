import { describe, it, expect } from "vitest";
import { schemaCheckout } from "./checkout";

/**
 * RED da issue 346 (D4b, Respostas do usuário 2026-10-03): telefone do cliente
 * exige DDD de 2 dígitos ao ser gravado — 10 (fixo) ou 11 (celular) dígitos
 * depois de remover máscara. Prefixo +55 fica fora deste RED (regra não definida).
 * Telefones fictícios.
 */
const base = {
  loja_id: "11111111-1111-1111-1111-111111111111",
  itens: [{ produto_id: "22222222-2222-2222-2222-222222222222", quantidade: 1 }],
  endereco: { cep: "01000-000", rua: "Rua Ficticia", numero: "1", bairro: "Centro", cidade: "Cidade Teste", uf: "SP" },
  forma_pagamento_id: "33333333-3333-3333-3333-333333333333",
  nome: "Cliente Teste",
};
const aceita = (telefone: string) => schemaCheckout.safeParse({ ...base, telefone }).success;

describe("schemaCheckout.telefone — DDD obrigatório (346 D4b)", () => {
  it.each(["(11) 90000-0000", "11900000000", "(21) 3000-0000", "2130000000", "11 90000-0000"])(
    "aceita telefone com DDD: %s",
    (tel) => {
      expect(aceita(tel)).toBe(true);
    },
  );

  it.each([
    ["sem DDD, celular 9 dígitos", "90000-0000"],
    ["sem DDD, fixo 8 dígitos", "3000-0000"],
    ["8 dígitos crus", "12345678"],
    ["9 dígitos crus", "900000000"],
    ["12 dígitos", "119000000000"],
    ["20 dígitos", "1".repeat(20)],
    ["DDD iniciado em 0", "(01) 90000-0000"],
  ])("rejeita %s: %s", (_rotulo, tel) => {
    expect(aceita(tel)).toBe(false);
  });
});
