// Testes RED-FIRST para src/lib/validacoes/opcional.ts
// Módulo ainda não existe — todos devem falhar na importação.

import { describe, it, expect } from "vitest";
import {
  schemaCategoriaOpcional,
  schemaOpcional,
  schemaAssociacaoCategoriaOpcional,
} from "./opcional";

const GUID_VALIDO = "550e8400-e29b-41d4-a716-446655440000";
const GUID_INVALIDO = "nao-e-um-guid";

describe("schemaCategoriaOpcional", () => {
  it("aceita nome e ordem válidos", () => {
    const result = schemaCategoriaOpcional.safeParse({ nome: "Molhos", ordem: 0 });
    expect(result.success).toBe(true);
  });

  it("rejeita nome vazio", () => {
    const result = schemaCategoriaOpcional.safeParse({ nome: "", ordem: 0 });
    expect(result.success).toBe(false);
  });

  it("rejeita ordem negativa", () => {
    const result = schemaCategoriaOpcional.safeParse({ nome: "Molhos", ordem: -1 });
    expect(result.success).toBe(false);
  });

  it("rejeita campo extra (.strict)", () => {
    const result = schemaCategoriaOpcional.safeParse({
      nome: "Molhos",
      ordem: 0,
      campo_extra: "invasor",
    });
    expect(result.success).toBe(false);
  });
});

describe("schemaOpcional", () => {
  const base = {
    nome: "Cheddar",
    preco: 2.5,
    categoria_opcional_id: GUID_VALIDO,
    ativo: true,
    ordem: 1,
  };

  it("aceita dados válidos", () => {
    const result = schemaOpcional.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejeita preco negativo", () => {
    const result = schemaOpcional.safeParse({ ...base, preco: -1 });
    expect(result.success).toBe(false);
  });

  it("rejeita preco com mais de 2 casas decimais", () => {
    const result = schemaOpcional.safeParse({ ...base, preco: 2.555 });
    expect(result.success).toBe(false);
  });

  it("aceita preco zero", () => {
    const result = schemaOpcional.safeParse({ ...base, preco: 0 });
    expect(result.success).toBe(true);
  });

  it("rejeita campo extra (.strict)", () => {
    const result = schemaOpcional.safeParse({ ...base, campo_extra: "invasor" });
    expect(result.success).toBe(false);
  });

  it("rejeita categoria_opcional_id inválido", () => {
    const result = schemaOpcional.safeParse({ ...base, categoria_opcional_id: GUID_INVALIDO });
    expect(result.success).toBe(false);
  });
});

describe("schemaAssociacaoCategoriaOpcional", () => {
  it("aceita categoria_id e array de guids válidos", () => {
    const result = schemaAssociacaoCategoriaOpcional.safeParse({
      categoria_id: GUID_VALIDO,
      categoria_opcional_id: [GUID_VALIDO],
    });
    expect(result.success).toBe(true);
  });

  it("aceita array vazio de categoria_opcional_id", () => {
    const result = schemaAssociacaoCategoriaOpcional.safeParse({
      categoria_id: GUID_VALIDO,
      categoria_opcional_id: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita campo extra (.strict — achado auditoria)", () => {
    const result = schemaAssociacaoCategoriaOpcional.safeParse({
      categoria_id: GUID_VALIDO,
      categoria_opcional_id: [GUID_VALIDO],
      loja_id: GUID_VALIDO, // injeção de loja_id alheio
    });
    expect(result.success).toBe(false);
  });

  it("rejeita uuid inválido em categoria_opcional_id", () => {
    const result = schemaAssociacaoCategoriaOpcional.safeParse({
      categoria_id: GUID_VALIDO,
      categoria_opcional_id: [GUID_INVALIDO],
    });
    expect(result.success).toBe(false);
  });

  it("rejeita categoria_id inválido", () => {
    const result = schemaAssociacaoCategoriaOpcional.safeParse({
      categoria_id: GUID_INVALIDO,
      categoria_opcional_id: [GUID_VALIDO],
    });
    expect(result.success).toBe(false);
  });
});
