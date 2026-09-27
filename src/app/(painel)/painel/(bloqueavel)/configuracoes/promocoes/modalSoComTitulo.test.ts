/**
 * [315] Aviso "só título" (RN-M02): helper puro, só UX, nunca bloqueia.
 */

import { describe, expect, it } from "vitest";

import { schemaModalSazonal } from "@/lib/validacoes/modalSazonal";
import { montarPayloadModalSazonal } from "./montarPayloadModalSazonal";
import { modalSoComTitulo } from "./modalSoComTitulo";

const CAT = "11111111-1111-4111-8111-111111111111";
const comTexto = (texto: string) => ({ versao: 1 as const, paragrafos: [{ trechos: [{ texto }] }] });

describe("modalSoComTitulo", () => {
  it("sem mensagem e sem seleção: avisa", () => {
    expect(modalSoComTitulo({ mensagem: null, categorias: [], cardapios: [] })).toBe(true);
  });

  it("mensagem só com espaço ou parágrafos vazios conta como sem mensagem", () => {
    expect(modalSoComTitulo({ mensagem: comTexto("   "), categorias: [], cardapios: [] })).toBe(true);
    expect(
      modalSoComTitulo({ mensagem: { paragrafos: [{ trechos: [] }, { trechos: [] }] }, categorias: [], cardapios: [] }),
    ).toBe(true);
  });

  it("com mensagem visível: não avisa", () => {
    expect(modalSoComTitulo({ mensagem: comTexto("Oi"), categorias: [], cardapios: [] })).toBe(false);
  });

  it("com categoria ou cardápio: não avisa", () => {
    expect(modalSoComTitulo({ mensagem: null, categorias: [CAT], cardapios: [] })).toBe(false);
    expect(modalSoComTitulo({ mensagem: null, categorias: [], cardapios: [CAT] })).toBe(false);
  });

  it("não bloqueia: o modal só com título passa no MESMO schema do servidor", () => {
    const campos = {
      titulo: "Inverno",
      exibicaoInicio: "2026-06-01T00:00",
      exibicaoFim: "2026-06-15T00:00",
      mensagem: null,
      categorias: [],
      cardapios: [],
      mostrarPromocoesJunto: false,
    };
    expect(modalSoComTitulo(campos)).toBe(true);
    expect(schemaModalSazonal.safeParse(montarPayloadModalSazonal(campos)).success).toBe(true);
  });
});
