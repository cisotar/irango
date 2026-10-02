import { describe, it, expect } from "vitest";
import { schemaPerfilCliente } from "./cliente";

/**
 * RED da issue 346 (D4b, Respostas do usuário 2026-10-03): telefone do cliente
 * exige DDD de 2 dígitos ao ser gravado — 10 (fixo) ou 11 (celular) dígitos
 * depois de remover máscara. Prefixo +55 fica fora deste RED (regra não definida).
 * Telefones fictícios.
 */
const base = { nome: "Cliente Teste", data_nascimento: "1990-05-10", aceita_marketing: false };
const aceita = (telefone: string) => schemaPerfilCliente.safeParse({ ...base, telefone }).success;

describe("schemaPerfilCliente — DDD obrigatório (346 D4b)", () => {
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
