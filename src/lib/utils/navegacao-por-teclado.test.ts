import { describe, it, expect } from "vitest";

import {
  ehTeclaDeNavegacaoHorizontal,
  proximoIndicePorTecla,
} from "./navegacao-por-teclado";

describe("ehTeclaDeNavegacaoHorizontal", () => {
  it("reconhece as 4 teclas do padrão APG", () => {
    expect(ehTeclaDeNavegacaoHorizontal("ArrowLeft")).toBe(true);
    expect(ehTeclaDeNavegacaoHorizontal("ArrowRight")).toBe(true);
    expect(ehTeclaDeNavegacaoHorizontal("Home")).toBe(true);
    expect(ehTeclaDeNavegacaoHorizontal("End")).toBe(true);
  });

  it("rejeita outras teclas — não pode capturar Tab, Enter, espaço etc.", () => {
    expect(ehTeclaDeNavegacaoHorizontal("Tab")).toBe(false);
    expect(ehTeclaDeNavegacaoHorizontal("Enter")).toBe(false);
    expect(ehTeclaDeNavegacaoHorizontal(" ")).toBe(false);
    expect(ehTeclaDeNavegacaoHorizontal("ArrowUp")).toBe(false);
    expect(ehTeclaDeNavegacaoHorizontal("ArrowDown")).toBe(false);
  });
});

describe("proximoIndicePorTecla", () => {
  it("ArrowRight avança um índice", () => {
    expect(proximoIndicePorTecla("ArrowRight", 0, 3)).toBe(1);
    expect(proximoIndicePorTecla("ArrowRight", 1, 3)).toBe(2);
  });

  it("ArrowRight no ÚLTIMO dá a volta para o primeiro — é o que falta hoje na tela", () => {
    // Era exatamente o defeito que a issue veio corrigir: sem isso, ArrowRight
    // parado no último item da tablist não fazia nada.
    expect(proximoIndicePorTecla("ArrowRight", 2, 3)).toBe(0);
  });

  it("ArrowLeft recua um índice", () => {
    expect(proximoIndicePorTecla("ArrowLeft", 2, 3)).toBe(1);
  });

  it("ArrowLeft no PRIMEIRO dá a volta para o último", () => {
    expect(proximoIndicePorTecla("ArrowLeft", 0, 3)).toBe(2);
  });

  it("Home vai para o primeiro, de qualquer posição", () => {
    expect(proximoIndicePorTecla("Home", 2, 5)).toBe(0);
    expect(proximoIndicePorTecla("Home", 0, 5)).toBe(0);
  });

  it("End vai para o último, de qualquer posição", () => {
    expect(proximoIndicePorTecla("End", 0, 5)).toBe(4);
    expect(proximoIndicePorTecla("End", 4, 5)).toBe(4);
  });

  it("com 2 abas (o caso real da página de opcionais), ArrowRight alterna entre as duas", () => {
    expect(proximoIndicePorTecla("ArrowRight", 0, 2)).toBe(1);
    expect(proximoIndicePorTecla("ArrowRight", 1, 2)).toBe(0);
  });

  it("total <= 0 devolve o índice recebido — nada para onde ir", () => {
    expect(proximoIndicePorTecla("ArrowRight", 0, 0)).toBe(0);
    expect(proximoIndicePorTecla("End", 3, 0)).toBe(3);
  });
});
