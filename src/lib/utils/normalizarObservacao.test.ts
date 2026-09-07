import { describe, it, expect } from "vitest";
// RED (issue 167): o módulo AINDA NÃO EXISTE. A fase GREEN (`executar`) cria
// src/lib/utils/normalizarObservacao.ts com a assinatura
//   export function normalizarObservacao(texto: string): string
// Enquanto ele não existir, este arquivo inteiro falha no load — esse é o RED.
import { normalizarObservacao, canonizarObservacao } from "./normalizarObservacao";
import { LIMITE_OBSERVACAO } from "@/lib/constants/pedido";

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

// ---------------------------------------------------------------------------
// Ordem das 7 transformações: entradas onde inverter dois passos adjacentes
// produziria uma saída DIFERENTE da atual. Se alguém reordenar o `.replace`
// chain do módulo, estes testes devem quebrar.
// ---------------------------------------------------------------------------
describe("normalizarObservacao — a ORDEM dos passos importa", () => {
  it("passo 1 (CRLF→LF) precisa rodar ANTES do passo 6 (colapso de linhas em branco): CRLF triplo colapsa para 2 quebras", () => {
    // Se o passo 6 rodasse primeiro, a regex /\n{3,}/ não casaria "\r\n\r\n\r\n"
    // (há \r intercalado entre os \n) e o resultado ficaria com 3 quebras.
    expect(normalizarObservacao("a\r\n\r\n\r\nb")).toBe("a\n\nb");
  });

  it("passo 1 antes do passo 6: CRLF triplo misturado com \\n solto também colapsa para 2", () => {
    expect(normalizarObservacao("a\r\n\n\r\nb")).toBe("a\n\nb");
  });

  it("passo 3 (remove invisíveis) precisa rodar ANTES do passo 5 (colapsa espaço horizontal): zero-width no meio de um run de espaços não impede o colapso", () => {
    // Zero-width space NÃO casa a classe [^\S\n] (não é whitespace p/ JS regex).
    // Se o passo 5 rodasse antes do 3, o ZWSP quebraria o run em dois runs de
    // 2 espaços cada, cada um colapsando para " " — sobrando dois espaços
    // separados por nada (ZWSP removido depois): "a  b" (2 espaços), não "a b".
    expect(normalizarObservacao(`a  ${ZWSP}  b`)).toBe("a b");
  });

  it("colapsa run misto de NBSP + tab entre duas palavras em um único espaço", () => {
    expect(normalizarObservacao(`a${NBSP}\t${NBSP}b`)).toBe("a b");
  });
});

// ---------------------------------------------------------------------------
// Surrogate pairs / emoji: JS `.length` conta unidades UTF-16, o
// `char_length` do Postgres conta CODEPOINTS. Para qualquer caractere fora do
// BMP (a maioria dos emoji), 1 codepoint = 2 unidades UTF-16 → `.length`
// SUPERESTIMA o tamanho em relação ao banco. Isso significa que o gate do zod
// (que usa `.length` via `.max()`) é sempre IGUAL OU MAIS RESTRITIVO que o
// CHECK do Postgres — nunca mais permissivo. Não há payload que passe no zod
// e viole o CHECK por causa de emoji/surrogate pairs.
// ---------------------------------------------------------------------------
describe("normalizarObservacao — surrogate pairs (emoji) vs. char_length do Postgres", () => {
  const EMOJI = "\u{1F600}"; // 😀 — fora do BMP, 2 unidades UTF-16, 1 codepoint

  it("emoji fora do BMP conta 2 no .length do JS mas 1 codepoint (o que o char_length do Postgres mediria)", () => {
    expect(EMOJI.length).toBe(2);
    expect(Array.from(EMOJI).length).toBe(1);
  });

  it("100 emoji: .length=200 (no limite do zod) só corresponde a 100 codepoints (bem abaixo do CHECK de 200 do banco)", () => {
    const entrada = EMOJI.repeat(100);
    expect(entrada).toHaveLength(200);
    expect(normalizarObservacao(entrada)).toHaveLength(200);
    // codepoints reais — o que o CHECK char_length(...) <= 200 do banco mede:
    expect(Array.from(normalizarObservacao(entrada)).length).toBe(100);
  });

  it("INVARIANTE: .length (JS) nunca é menor que a contagem de codepoints (Array.from) — o gate do zod nunca é mais permissivo que o char_length do banco", () => {
    const fixturas = [
      "sem cebola",
      EMOJI.repeat(50),
      "a" + EMOJI + "b" + EMOJI,
      "café com açúcar", // acentos precompostos, 1 codepoint cada
      EMOJI.repeat(1) + "texto normal" + EMOJI.repeat(3),
    ];
    for (const entrada of fixturas) {
      const saida = normalizarObservacao(entrada);
      expect(saida.length).toBeGreaterThanOrEqual(Array.from(saida).length);
    }
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

// Achado MÉDIA do `auditar` na issue 167: a classe do passo 3 parava em U+2064
// e o comentário prometia cobrir "overrides RTL (spoofing de comanda)". Ficavam
// de fora os isolates do Trojan Source (CVE-2021-42574) e o ALM.
describe("normalizarObservacao — controle bidirecional completo (CVE-2021-42574)", () => {
  const BIDI = [
    ["U+061C ALM", "؜"],
    ["U+2066 LRI", "⁦"],
    ["U+2067 RLI", "⁧"],
    ["U+2068 FSI", "⁨"],
    ["U+2069 PDI", "⁩"],
    ["U+206A inibidor de simetria", "⁪"],
    ["U+206F formatação de dígito", "⁯"],
  ] as const;

  it.each(BIDI)("remove %s do texto", (_nome, char) => {
    expect(normalizarObservacao(`sem${char} cebola`)).toBe("sem cebola");
  });

  it("neutraliza o par isolate que reordena a comanda visualmente", () => {
    // Sem a correção, o lojista imprime uma comanda que lê diferente do que
    // está gravado no banco.
    const ataque = "Pizza ⁦⁧ GRATIS ⁩ sem queijo";
    const saida = normalizarObservacao(ataque);
    for (const [, char] of BIDI) {
      expect(saida).not.toContain(char);
    }
    expect(saida).toBe("Pizza GRATIS sem queijo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RED (issue 168) — `canonizarObservacao`: a função que define a IDENTIDADE da
// linha do carrinho (chave de dedup de `linhaCarrinhoId`) e, por tabela, a
// QUANTIDADE que sai no payload. Ainda não implementada: o STUB TDD em
// normalizarObservacao.ts lança `TODO: GREEN`.
//
// Contrato (plan/168): normaliza → corta em LIMITE_OBSERVACAO SEM deixar high
// surrogate solto (UTF-8 inválido; o Postgres recusa o INSERT) → normaliza de
// novo. Idempotente e só encurta.
// ═══════════════════════════════════════════════════════════════════════════


// Entradas adversas reusadas pelos casos 14-16.
const ADVERSAS = [
  "",
  "   ",
  "sem cebola",
  "sem  cebola",
  ` sem${NBSP}cebola `,
  `${ZWSP}sem cebola${BOM}`,
  "linha1\r\nlinha2",
  `${RLO}sem cebola`,
  "a".repeat(LIMITE_OBSERVACAO),
  "a".repeat(LIMITE_OBSERVACAO + 50),
  "x ".repeat(LIMITE_OBSERVACAO),
  "🍔".repeat(LIMITE_OBSERVACAO),
];

describe("canonizarObservacao (issue 168) — identidade da linha do carrinho", () => {
  // [14] Idempotência é OBRIGATÓRIA: a chave é recalculada a cada render a
  // partir do valor já guardado. Sem idempotência a linha "muda de identidade"
  // entre dois renders e a quantidade se funde/cinde sozinha.
  it("[14] é idempotente para toda entrada adversa", () => {
    for (const entrada of ADVERSAS) {
      const uma = canonizarObservacao(entrada);
      expect(canonizarObservacao(uma)).toBe(uma);
    }
  });

  // [15] Herda a invariante do módulo: só encurta, nunca expande.
  it("[15] nunca expande o comprimento", () => {
    for (const entrada of ADVERSAS) {
      expect(canonizarObservacao(entrada).length).toBeLessThanOrEqual(entrada.length);
    }
  });

  // [16] O corte só dispara com sessionStorage adulterado, mas sem ele o
  // checkout INTEIRO cai com erro genérico (schemaObservacao rejeita, não trunca).
  it("[16] corta em LIMITE_OBSERVACAO (constante, nunca o literal)", () => {
    for (const entrada of ADVERSAS) {
      expect(canonizarObservacao(entrada).length).toBeLessThanOrEqual(LIMITE_OBSERVACAO);
    }
    expect(canonizarObservacao("a".repeat(LIMITE_OBSERVACAO * 3)).length).toBe(
      LIMITE_OBSERVACAO,
    );
  });

  // [16b] Texto canônico dentro do teto passa intacto.
  it("[16b] texto já canônico e dentro do teto sai idêntico", () => {
    const texto = "sem cebola, ponto da carne bem passado";
    expect(canonizarObservacao(texto)).toBe(texto);
    const noLimite = "a".repeat(LIMITE_OBSERVACAO);
    expect(canonizarObservacao(noLimite)).toBe(noLimite);
  });

  // [17] `.max()` do zod conta unidades UTF-16 (o corte precisa ser por unidade),
  // mas um high surrogate solto é UTF-8 inválido e o Postgres recusa o INSERT.
  it("[17] corte no meio de par substituto não deixa high surrogate solto", () => {
    // Emoji ocupa 2 unidades UTF-16: com LIMITE ímpar o corte cai no meio do par.
    for (const prefixo of ["", "a", "ab"]) {
      const entrada = prefixo + "🍔".repeat(LIMITE_OBSERVACAO);
      const saida = canonizarObservacao(entrada);
      expect(saida.length).toBeLessThanOrEqual(LIMITE_OBSERVACAO);
      expect(/[\uD800-\uDBFF]$/.test(saida)).toBe(false);
      // Prova forte: o resultado é UTF-8 codificável sem substituição (U+FFFD).
      const roundtrip = new TextDecoder().decode(new TextEncoder().encode(saida));
      expect(roundtrip).toBe(saida);
    }
  });
});
