import { describe, it, expect } from "vitest";
// RED (issue 167): o módulo AINDA NÃO EXISTE. A fase GREEN (`executar`) cria
// src/lib/utils/normalizarObservacao.ts com a assinatura
//   export function normalizarObservacao(texto: string): string
// Enquanto ele não existir, este arquivo inteiro falha no load — esse é o RED.
import { normalizarObservacao } from "./normalizarObservacao";

// ---------------------------------------------------------------------------
// Por que esta função existe (plan/167 §Decisão 2):
// o `trim` do Postgres é btrim(), que remove SÓ espaço ASCII (U+0020). \n, \r,
// \t e NBSP (U+00A0) atravessam o nullif(trim(...),'') da RPC intactos e
// CONTAM PARA O TETO de 200. O TS é a autoridade; o SQL é defesa em profundidade.
//
// Invariante de segurança: cada passo só ENCURTA ou MANTÉM o comprimento —
// nunca expande. É o que garante que o maxLength={200} do cliente (issue 169)
// jamais produza um payload que o servidor rejeite por tamanho.
// ---------------------------------------------------------------------------

const NBSP = "\u00A0";
const ZWSP = "\u200B";
const RLO = "\u202E"; // right-to-left override — spoofing de comanda
const BOM = "\uFEFF";

describe("normalizarObservacao — passo 1: CRLF/CR → LF", () => {
  it("converte CRLF em LF", () => {
    expect(normalizarObservacao("linha1\r\nlinha2")).toBe("linha1\nlinha2");
  });

  it("converte CR solto em LF", () => {
    expect(normalizarObservacao("linha1\rlinha2")).toBe("linha1\nlinha2");
  });

  it("não duplica quebras ao converter CRLF (encurta 1 char por quebra)", () => {
    expect(normalizarObservacao("a\r\nb\r\nc")).toBe("a\nb\nc");
  });
});

describe("normalizarObservacao — passo 2: controles C0/C1 e DEL", () => {
  it("remove NUL e controles C0 do meio do texto", () => {
    expect(normalizarObservacao("sem\u0000ceb\u0001ola")).toBe("semcebola");
  });

  it("remove ESC (U+001B) — sequência de escape de impressora térmica", () => {
    expect(normalizarObservacao("a\u001B[1mb")).toBe("a[1mb");
  });

  it("remove DEL (U+007F) e controles C1 (U+0085, U+009F)", () => {
    expect(normalizarObservacao("a\u007Fb\u0085c\u009Fd")).toBe("abcd");
  });

  it("PRESERVA \\n (U+000A) — é textarea, quebra de linha é legítima", () => {
    expect(normalizarObservacao("sem cebola\ntrocar batata")).toBe(
      "sem cebola\ntrocar batata",
    );
  });

  it("PRESERVA \\t (U+0009) no passo 2 — ele só vira espaço no passo 4", () => {
    // Se o passo 2 apagasse o \t, o resultado seria "ab" e não "a b".
    expect(normalizarObservacao("a\tb")).toBe("a b");
  });
});

describe("normalizarObservacao — passo 3: invisíveis, bidi e BOM", () => {
  it("remove zero-width space (U+200B)", () => {
    expect(normalizarObservacao(`a${ZWSP}b`)).toBe("ab");
  });

  it("remove override bidi RLO (U+202E) — anti-spoofing de comanda", () => {
    expect(normalizarObservacao(`a${RLO}b`)).toBe("ab");
  });

  it("remove BOM (U+FEFF) e word joiner (U+2060)", () => {
    expect(normalizarObservacao(`${BOM}a\u2060b`)).toBe("ab");
  });

  it("remove separadores de linha/parágrafo U+2028 / U+2029", () => {
    expect(normalizarObservacao("a\u2028b\u2029c")).toBe("abc");
  });

  it("200 caracteres invisíveis colapsam para string vazia", () => {
    expect(normalizarObservacao(ZWSP.repeat(200))).toBe("");
  });
});

describe("normalizarObservacao — passo 4: tab → espaço", () => {
  it("troca tab por espaço (tab quebra alinhamento de comanda)", () => {
    expect(normalizarObservacao("bem\tpassado")).toBe("bem passado");
  });

  it("tabs consecutivos viram um único espaço (passo 4 + passo 5)", () => {
    expect(normalizarObservacao("bem\t\t\tpassado")).toBe("bem passado");
  });
});

describe("normalizarObservacao — passo 5: colapsa espaço horizontal repetido", () => {
  it("colapsa run de espaços ASCII em um só", () => {
    expect(normalizarObservacao("sem      cebola")).toBe("sem cebola");
  });

  it("colapsa run de NBSP (U+00A0) — o btrim do Postgres NÃO faria isso", () => {
    expect(normalizarObservacao(`sem${NBSP}${NBSP}${NBSP}cebola`)).toBe("sem cebola");
  });

  it("NÃO colapsa quebras de linha (o \\n é preservado como separador)", () => {
    expect(normalizarObservacao("linha1\nlinha2")).toBe("linha1\nlinha2");
  });

  it("200 NBSPs colapsam para string vazia (anti-padding)", () => {
    expect(normalizarObservacao(NBSP.repeat(200))).toBe("");
  });
});

describe("normalizarObservacao — passo 6: no máximo uma linha em branco", () => {
  it("colapsa 3 quebras em 2", () => {
    expect(normalizarObservacao("a\n\n\nb")).toBe("a\n\nb");
  });

  it("50 quebras seguidas colapsam para 2", () => {
    expect(normalizarObservacao(`a${"\n".repeat(50)}b`)).toBe("a\n\nb");
  });

  it("preserva exatamente 2 quebras (parágrafo legítimo)", () => {
    expect(normalizarObservacao("a\n\nb")).toBe("a\n\nb");
  });
});

describe("normalizarObservacao — passo 7: trim final das bordas", () => {
  it("remove espaços das bordas", () => {
    expect(normalizarObservacao("   sem cebola   ")).toBe("sem cebola");
  });

  it("remove \\n, \\t e NBSP das bordas (btrim do Postgres não removeria)", () => {
    expect(normalizarObservacao(`\n\t${NBSP} sem cebola ${NBSP}\t\n`)).toBe("sem cebola");
  });

  it("texto só de espaços vira string vazia (NÃO lança, NÃO rejeita)", () => {
    expect(normalizarObservacao("   ")).toBe("");
  });

  it("texto só de whitespace misto vira string vazia", () => {
    expect(normalizarObservacao("\n\t ")).toBe("");
  });

  it("string vazia continua vazia", () => {
    expect(normalizarObservacao("")).toBe("");
  });
});

describe("normalizarObservacao — comprimento (o gate de 200 depende disto)", () => {
  it("210 chars com 15 de padding nas bordas normalizam para 195", () => {
    const entrada = " ".repeat(15) + "a".repeat(195);
    expect(entrada).toHaveLength(210);
    expect(normalizarObservacao(entrada)).toHaveLength(195);
  });

  it("201 chars VISÍVEIS continuam 201 — a normalização não salva o excesso", () => {
    expect(normalizarObservacao("a".repeat(201))).toHaveLength(201);
  });

  it("201 chars que só cabem DEPOIS de normalizar: 190 visíveis + 11 controles → 190", () => {
    const entrada = "a".repeat(190) + "\u0000".repeat(11);
    expect(entrada).toHaveLength(201);
    expect(normalizarObservacao(entrada)).toHaveLength(190);
  });

  it("500 controles + 100 visíveis → 100 (prova a ordem normalizar → medir)", () => {
    const entrada = "\u001B".repeat(500) + "b".repeat(100);
    expect(normalizarObservacao(entrada)).toBe("b".repeat(100));
  });

  it("INVARIANTE: a saída nunca é mais longa que a entrada", () => {
    const fixturas = [
      "",
      "   ",
      "sem cebola",
      "a\r\nb\r\nc",
      "a\u0000\u001B\u007F\u009Fb",
      `a${ZWSP}${RLO}${BOM}b`,
      "a\t\t\tb",
      `a${NBSP.repeat(30)}b`,
      "a" + "\n".repeat(50) + "b",
      " ".repeat(15) + "x".repeat(195),
      "a".repeat(201),
      "\u001B".repeat(500) + "b".repeat(100),
      "linha1\n\nlinha2\n\n\n\nlinha3",
    ];
    for (const entrada of fixturas) {
      expect(normalizarObservacao(entrada).length).toBeLessThanOrEqual(entrada.length);
    }
  });

  it("INVARIANTE: normalizar é idempotente (normalizar duas vezes = uma)", () => {
    const fixturas = [
      "sem cebola\r\n\r\n\r\ntrocar   batata",
      `${BOM}  a\t\tb${NBSP}${NBSP}c  `,
      "a" + "\n".repeat(9) + "b",
    ];
    for (const entrada of fixturas) {
      const uma = normalizarObservacao(entrada);
      expect(normalizarObservacao(uma)).toBe(uma);
    }
  });
});

describe("normalizarObservacao — caminho real do cliente", () => {
  it("observação típica de textarea sobrevive intacta", () => {
    expect(normalizarObservacao("sem cebola\ntrocar batata por salada")).toBe(
      "sem cebola\ntrocar batata por salada",
    );
  });

  it("textarea de Windows com padding e parágrafos vira forma canônica", () => {
    const entrada = "  sem cebola\r\n\r\n\r\ntrocar\tbatata  ";
    expect(normalizarObservacao(entrada)).toBe("sem cebola\n\ntrocar batata");
  });
});
