import { describe, it, expect } from "vitest";
import { schemaPayloadPedido } from "./pedido";

/**
 * RED da issue 346 (D4b, Respostas do usuário 2026-10-03): telefone do cliente
 * exige DDD de 2 dígitos ao ser gravado — 10 (fixo) ou 11 (celular) dígitos
 * depois de remover máscara. Prefixo +55 fica fora deste RED (regra não definida).
 * Telefones fictícios.
 */
const base = {
  loja_id: "11111111-1111-4111-8111-111111111111",
  tipo_entrega: "entrega",
  itens: [{ produto_id: "22222222-2222-4222-8222-222222222222", quantidade: 1 }],
  endereco_entrega: { cep: "01001-000", rua: "Rua Ficticia", numero: "1", bairro: "Centro" },
  forma_pagamento: "pix",
  nome_cliente: "Cliente Teste",
};
const aceita = (telefone_cliente: string) => schemaPayloadPedido.safeParse({ ...base, telefone_cliente }).success;

describe("schemaPayloadPedido.telefone_cliente — DDD obrigatório (346 D4b)", () => {
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
