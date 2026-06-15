import { describe, it, expect } from "vitest";
import {
  calcularDimensoesAlvo,
  exportarCrop,
  LARGURA_ALVO_PADRAO,
  ASPECT_FOTO,
} from "./exportarCrop";

// ---------------------------------------------------------------------------
// calcularDimensoesAlvo — função pura, testável em node
//
// Contrato:
//   - aspect fixo 4:3 (ASPECT_FOTO = 4/3)
//   - largura = round(larguraAlvo)
//   - altura  = round(largura / ASPECT_FOTO)
//   - default sem argumento → LARGURA_ALVO_PADRAO (1280) → { largura: 1280, altura: 960 }
// ---------------------------------------------------------------------------

describe("calcularDimensoesAlvo — resultado 4:3", () => {
  it("padrão sem argumento → 1280×960", () => {
    const d = calcularDimensoesAlvo();
    expect(d).toEqual({ largura: 1280, altura: 960 });
  });

  it("padrão explícito (LARGURA_ALVO_PADRAO) → mesmo que sem argumento", () => {
    expect(calcularDimensoesAlvo(LARGURA_ALVO_PADRAO)).toEqual(
      calcularDimensoesAlvo(),
    );
  });

  it("640 → { largura: 640, altura: 480 }  (4:3 perfeito)", () => {
    expect(calcularDimensoesAlvo(640)).toEqual({ largura: 640, altura: 480 });
  });

  it("800 → { largura: 800, altura: 600 }  (4:3 perfeito)", () => {
    expect(calcularDimensoesAlvo(800)).toEqual({ largura: 800, altura: 600 });
  });

  it("1920 → { largura: 1920, altura: 1440 }  (4:3 perfeito)", () => {
    expect(calcularDimensoesAlvo(1920)).toEqual({ largura: 1920, altura: 1440 });
  });

  it("proporção resultante é exatamente 4:3 para múltiplos de 4", () => {
    const { largura, altura } = calcularDimensoesAlvo(1280);
    // largura / altura deve ser 4/3
    expect(largura / altura).toBeCloseTo(ASPECT_FOTO, 10);
  });

  it("valor não-múltiplo de 4 → arredonda (100 → altura round(100 / (4/3)) = round(75) = 75)", () => {
    // 100 / (4/3) = 100 * 3/4 = 75  — exato
    const d = calcularDimensoesAlvo(100);
    expect(d.largura).toBe(100);
    expect(d.altura).toBe(75);
  });

  it("valor com parte decimal → largura é arredondada antes de calcular altura (101.6 → 102)", () => {
    // largura = round(101.6) = 102; altura = round(102 / (4/3)) = round(76.5) = 77
    // (Math.round(76.5) = 77 em IEEE-754 half-up)
    const d = calcularDimensoesAlvo(101.6);
    expect(d.largura).toBe(102);
    // altura = round(102 * 3 / 4) = round(76.5) = 77
    expect(d.altura).toBe(Math.round(102 / ASPECT_FOTO));
  });

  it("valor muito pequeno (4) → { largura: 4, altura: 3 }", () => {
    // 4 / (4/3) = 3 — exato
    expect(calcularDimensoesAlvo(4)).toEqual({ largura: 4, altura: 3 });
  });

  it("valor 1 → { largura: 1, altura: 1 }  (round(1 / (4/3)) = round(0.75) = 1)", () => {
    // Mínimo absoluto: round(0.75) = 1 em JS (half-up)
    expect(calcularDimensoesAlvo(1)).toEqual({ largura: 1, altura: 1 });
  });

  it("valor grande (8000) → { largura: 8000, altura: 6000 }  (4:3 perfeito)", () => {
    expect(calcularDimensoesAlvo(8000)).toEqual({ largura: 8000, altura: 6000 });
  });

  it("retorna sempre inteiros — largura e altura são resultado de Math.round", () => {
    // Para qualquer largura passada, ambas as propriedades devem ser inteiros
    for (const l of [1, 7, 99, 333, 1024, 2048, 3001]) {
      const d = calcularDimensoesAlvo(l);
      expect(Number.isInteger(d.largura)).toBe(true);
      expect(Number.isInteger(d.altura)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// exportarCrop — validação de croppedAreaPixels degenerado
//
// A guarda `if (width <= 0 || height <= 0)` está na primeira linha do corpo
// assíncrono, ANTES de qualquer I/O de DOM. Por isso é testável em node:
// a promise rejeita imediatamente com "Recorte inválido." sem tocar em
// Image/canvas. Os paths pós-canvas (toBlob null, ctx null) dependem de DOM
// real e são cobertos via componente 076 (browser).
// ---------------------------------------------------------------------------

const areaPadrao = { x: 0, y: 0, width: 100, height: 100 };

describe("exportarCrop — rejeição por croppedAreaPixels degenerado (sem DOM)", () => {
  it("width === 0 → rejeita com 'Recorte inválido.'", async () => {
    await expect(
      exportarCrop({
        imageSrc: "blob:irrelevante",
        croppedAreaPixels: { ...areaPadrao, width: 0 },
      }),
    ).rejects.toThrow("Recorte inválido.");
  });

  it("height === 0 → rejeita com 'Recorte inválido.'", async () => {
    await expect(
      exportarCrop({
        imageSrc: "blob:irrelevante",
        croppedAreaPixels: { ...areaPadrao, height: 0 },
      }),
    ).rejects.toThrow("Recorte inválido.");
  });

  it("width negativo → rejeita com 'Recorte inválido.'", async () => {
    await expect(
      exportarCrop({
        imageSrc: "blob:irrelevante",
        croppedAreaPixels: { ...areaPadrao, width: -1 },
      }),
    ).rejects.toThrow("Recorte inválido.");
  });

  it("height negativo → rejeita com 'Recorte inválido.'", async () => {
    await expect(
      exportarCrop({
        imageSrc: "blob:irrelevante",
        croppedAreaPixels: { ...areaPadrao, height: -50 },
      }),
    ).rejects.toThrow("Recorte inválido.");
  });

  it("width e height ambos zero → rejeita com 'Recorte inválido.'", async () => {
    await expect(
      exportarCrop({
        imageSrc: "blob:irrelevante",
        croppedAreaPixels: { x: 0, y: 0, width: 0, height: 0 },
      }),
    ).rejects.toThrow("Recorte inválido.");
  });

  it("width -0 (zero negativo) → rejeita (não passa na guarda width <= 0)", async () => {
    // Object.is(-0, 0) é false, mas -0 <= 0 é true em JS — guarda cobre este caso
    await expect(
      exportarCrop({
        imageSrc: "blob:irrelevante",
        croppedAreaPixels: { x: 0, y: 0, width: -0, height: 100 },
      }),
    ).rejects.toThrow("Recorte inválido.");
  });

  it("rejeição é imediata — não acessa DOM (Image/document.createElement)", async () => {
    // Em environment:node, Image e document são undefined.
    // Se o código chegasse ao carregarImagem(), explodiria com ReferenceError,
    // não com "Recorte inválido." — esta asserção prova que a guarda vem antes.
    const p = exportarCrop({
      imageSrc: "blob:irrelevante",
      croppedAreaPixels: { x: 0, y: 0, width: -1, height: -1 },
    });
    await expect(p).rejects.toThrow("Recorte inválido.");
  });
});
