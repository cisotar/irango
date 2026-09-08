import { describe, it, expect } from "vitest";
import { moverPorDeslocamento, mensagemPosicao } from "./reordenar";

/**
 * Cenários 1, 2, 3 e 8 da issue 175. Puro: sem mock, sem DOM, sem banco.
 *
 * A distinção que este arquivo existe para travar é DESLOCAMENTO vs TROCA DE
 * PARES. As duas produzem o mesmo resultado quando os índices são adjacentes,
 * então todo caso abaixo usa índices NÃO adjacentes — só assim a asserção
 * consegue reprovar uma implementação de troca.
 */
describe("moverPorDeslocamento", () => {
  const LISTA = ["A", "B", "C", "D"] as const;

  // ─────────────────────────────────────────────── cenário 1
  it("[C1] desloca para frente, não troca: [A,B,C,D] (0→2) = [B,C,A,D]", () => {
    expect(moverPorDeslocamento(LISTA, 0, 2)).toEqual(["B", "C", "A", "D"]);
    // Uma troca de pares daria [C,B,A,D] — a asserção acima já reprova isso,
    // mas o contra-exemplo fica explícito para quem ler o teste.
    expect(moverPorDeslocamento(LISTA, 0, 2)).not.toEqual([
      "C",
      "B",
      "A",
      "D",
    ]);
  });

  // ─────────────────────────────────────────────── cenário 2
  it("[C2] desloca para trás: [A,B,C,D] (3→1) = [A,D,B,C]", () => {
    expect(moverPorDeslocamento(LISTA, 3, 1)).toEqual(["A", "D", "B", "C"]);
  });

  it("não muta o array de entrada", () => {
    const original = ["A", "B", "C", "D"];
    moverPorDeslocamento(original, 0, 3);
    expect(original).toEqual(["A", "B", "C", "D"]);
  });

  // ─────────────────────────────────────────────── cenário 3
  it("[C3] mover para a própria posição devolve a MESMA REFERÊNCIA (zero escrita)", () => {
    // `===`, não `toEqual`: é a identidade referencial que o caller usa para
    // decidir "não chamar a Server Action".
    expect(moverPorDeslocamento(LISTA, 2, 2)).toBe(LISTA);
  });

  // ─────────────────────────────────────────────── cenário 8
  it("[C8] ↑ na primeira posição (para = -1) é no-op, NÃO dá a volta para o fim", () => {
    // Este é exatamente o bug do `arrayMove` do @dnd-kit/sortable, que faz
    // `splice(to < 0 ? length + to : to, …)` e mandaria "A" para o último lugar.
    expect(moverPorDeslocamento(LISTA, 0, -1)).toBe(LISTA);
    expect(moverPorDeslocamento(LISTA, 0, -1)).not.toEqual([
      "B",
      "C",
      "D",
      "A",
    ]);
  });

  it("[C8] ↓ na última posição (para = length) é no-op", () => {
    expect(moverPorDeslocamento(LISTA, 3, 4)).toBe(LISTA);
  });

  it("índice de origem fora do intervalo é no-op", () => {
    expect(moverPorDeslocamento(LISTA, -1, 1)).toBe(LISTA);
    expect(moverPorDeslocamento(LISTA, 4, 1)).toBe(LISTA);
  });

  it("índice não inteiro (NaN, fracionário, Infinity) é no-op", () => {
    // `indexOf` devolve -1 e um cast frouxo pode produzir NaN: sem este guard,
    // o splice silenciosamente trataria NaN como 0 e moveria o item errado.
    expect(moverPorDeslocamento(LISTA, Number.NaN, 1)).toBe(LISTA);
    expect(moverPorDeslocamento(LISTA, 1, Number.NaN)).toBe(LISTA);
    expect(moverPorDeslocamento(LISTA, 1.5, 2)).toBe(LISTA);
    expect(moverPorDeslocamento(LISTA, 0, Number.POSITIVE_INFINITY)).toBe(
      LISTA,
    );
  });

  it("lista vazia ou de 1 item é sempre no-op", () => {
    const vazia = [] as const;
    const unica = ["A"] as const;
    expect(moverPorDeslocamento(vazia, 0, 0)).toBe(vazia);
    expect(moverPorDeslocamento(unica, 0, 1)).toBe(unica);
  });

  it("mover para o topo e para o fim (kebab) usam o mesmo contrato", () => {
    expect(moverPorDeslocamento(LISTA, 2, 0)).toEqual(["C", "A", "B", "D"]);
    expect(moverPorDeslocamento(LISTA, 1, LISTA.length - 1)).toEqual([
      "A",
      "C",
      "D",
      "B",
    ]);
    // Já no topo / já no fim → `de === para` → no-op.
    expect(moverPorDeslocamento(LISTA, 0, 0)).toBe(LISTA);
    expect(moverPorDeslocamento(LISTA, 3, LISTA.length - 1)).toBe(LISTA);
  });
});

describe("mensagemPosicao", () => {
  it("nomeia a categoria e a posição resultante sobre o total (1-based)", () => {
    expect(mensagemPosicao("Pizzas", 1, 6)).toBe(
      "Pizzas movida para a posição 2 de 6.",
    );
    expect(mensagemPosicao("Bebidas", 0, 3)).toBe(
      "Bebidas movida para a posição 1 de 3.",
    );
  });
});
