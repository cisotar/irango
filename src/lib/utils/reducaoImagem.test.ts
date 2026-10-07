import { describe, it, expect } from "vitest";

import { LADO_MAXIMO_ORIGINAL, LADO_MINIATURA } from "@/lib/actions/galeria-contrato";
import {
  calcularDimensoesReducao,
  LIMITE_PAR_ENVIO_BYTES,
  validarArquivoParaGaleria,
} from "./reducaoImagem";

/**
 * Parte PURA da redução no navegador (P4, P9/D7). O caminho de canvas é o de
 * `exportarCrop`, que não roda em `environment: node`; aqui se prova só o que
 * decide as dimensões que ele recebe.
 */

describe("calcularDimensoesReducao", () => {
  it("foto de celular paisagem 4032×3024 → lado maior 2048, proporção mantida", () => {
    expect(calcularDimensoesReducao(4032, 3024, LADO_MAXIMO_ORIGINAL)).toEqual({
      largura: 2048,
      altura: 1536,
    });
  });

  it("retrato 3024×4032 → a ALTURA vira o lado maior de 2048", () => {
    expect(calcularDimensoesReducao(3024, 4032, LADO_MAXIMO_ORIGINAL)).toEqual({
      largura: 1536,
      altura: 2048,
    });
  });

  it("miniatura de 400 px sai da mesma conta", () => {
    expect(calcularDimensoesReducao(4032, 3024, LADO_MINIATURA)).toEqual({
      largura: 400,
      altura: 300,
    });
  });

  it("nunca amplia: imagem menor que o limite volta como está", () => {
    expect(calcularDimensoesReducao(320, 320, LADO_MAXIMO_ORIGINAL)).toEqual({
      largura: 320,
      altura: 320,
    });
    expect(calcularDimensoesReducao(300, 200, LADO_MINIATURA)).toEqual({
      largura: 300,
      altura: 200,
    });
  });

  it("exatamente no limite não muda", () => {
    expect(calcularDimensoesReducao(2048, 1000, LADO_MAXIMO_ORIGINAL)).toEqual({
      largura: 2048,
      altura: 1000,
    });
  });

  it("devolve inteiros, mesmo quando a escala não é exata", () => {
    const r = calcularDimensoesReducao(3000, 1999, LADO_MINIATURA);
    expect(Number.isInteger(r.largura)).toBe(true);
    expect(Number.isInteger(r.altura)).toBe(true);
    expect(r).toEqual({ largura: 400, altura: 267 });
  });

  it("faixa extrema não zera o lado menor (piso 1)", () => {
    expect(calcularDimensoesReducao(10000, 1, LADO_MINIATURA)).toEqual({
      largura: 400,
      altura: 1,
    });
  });

  it("dimensão fracionária abaixo do limite é arredondada, com piso 1", () => {
    expect(calcularDimensoesReducao(0.4, 10.6, LADO_MINIATURA)).toEqual({
      largura: 1,
      altura: 11,
    });
  });

  it.each([
    [0, 100, 400],
    [100, -1, 400],
    [100, 100, 0],
    [Number.NaN, 100, 400],
    [100, Number.POSITIVE_INFINITY, 400],
  ])("recusa entrada inválida (%s, %s, %s)", (w, h, lado) => {
    expect(() => calcularDimensoesReducao(w, h, lado)).toThrow(RangeError);
  });
});

describe("LIMITE_PAR_ENVIO_BYTES (RN-G5)", () => {
  it("é 1,9 MB: abaixo do bodySizeLimit de 2 MB das Server Actions", () => {
    expect(LIMITE_PAR_ENVIO_BYTES).toBe(Math.floor(1.9 * 1024 * 1024));
    expect(LIMITE_PAR_ENVIO_BYTES).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("validarArquivoParaGaleria (gate de UX antes de reduzir)", () => {
  const JPEG = [0xff, 0xd8, 0xff, 0xe0];

  function arquivo(bytes: number[], tipo: string, tamanho = 64): Blob {
    const buf = new Uint8Array(tamanho);
    buf.set(bytes, 0);
    return new Blob([buf], { type: tipo });
  }

  it("aceita JPEG de verdade", async () => {
    expect(await validarArquivoParaGaleria(arquivo(JPEG, "image/jpeg"))).toBeNull();
  });

  it("NÃO barra o tamanho cru: a foto de 6 MB do celular é reduzida antes de subir (P4)", async () => {
    expect(await validarArquivoParaGaleria(arquivo(JPEG, "image/jpeg", 6 * 1024 * 1024))).toBeNull();
  });

  it("recusa tipo fora da whitelist e conteúdo que mente o tipo", async () => {
    expect(await validarArquivoParaGaleria(arquivo(JPEG, "image/gif"))).not.toBeNull();
    expect(await validarArquivoParaGaleria(arquivo([0x4d, 0x5a], "image/jpeg"))).not.toBeNull();
  });

  it("recusa arquivo vazio", async () => {
    expect(await validarArquivoParaGaleria(new Blob([], { type: "image/jpeg" }))).not.toBeNull();
  });
});
