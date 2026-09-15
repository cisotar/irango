import { describe, expect, it } from "vitest";
import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";
import {
  filtrarCatalogo,
  normalizarBusca,
  partirPorTermo,
} from "./buscarProdutos";

// RED-first: a armadilha real da issue 199 e o motivo deste modulo existir.
// Nome de produto vem frequentemente em NFD do banco ("Pão" = 4 chars),
// enquanto a forma normalizada de busca tem 3 ("pao"). Fatiar a string ORIGINAL
// com offsets da NORMALIZADA desloca o realce silenciosamente.
describe("partirPorTermo — alinhamento de indice sob NFD", () => {
  it("casa 'pao' em nome NFD e devolve o trecho original com acento intacto", () => {
    const nfd = "Pão de queijo"; // "Pão de queijo" decomposto
    expect(partirPorTermo(nfd, "pao")).toEqual([
      { texto: "Pão", casa: true },
      { texto: " de queijo", casa: false },
    ]);
  });

  it("reconstroi a string original exatamente (sem perda nem duplicacao)", () => {
    const casos: [string, string][] = [
      ["Pão de queijo", "pao"],
      ["Pão de queijo", "pao"],
      ["Café com açúcar", "CAFE"],
      ["Batata assada", "a"],
      ["Sucos naturais", ""],
      ["Bolo", "zzz"],
    ];
    for (const [texto, termo] of casos) {
      expect(
        partirPorTermo(texto, termo)
          .map((p) => p.texto)
          .join(""),
      ).toBe(texto);
    }
  });
});

const catalogo: CategoriaComProdutos[] = [
  {
    id: "cat-padaria",
    nome: "Padaria",
    produtos: [
      {
        id: "p1",
        nome: "Pão de queijo",
        descricao: "Assado na hora",
        preco: 5,
        foto_url: null,
        categoria_id: "cat-padaria",
        disponivel: true,
      },
      {
        id: "p2",
        nome: "Broa de milho",
        descricao: null,
        preco: 7,
        foto_url: null,
        categoria_id: "cat-padaria",
        disponivel: true,
      },
    ],
  },
  {
    id: "cat-bebidas",
    nome: "Bebidas",
    exibir_imagens: false,
    produtos: [
      {
        id: "p3",
        nome: "Café expresso",
        descricao: "Grão torrado no dia",
        preco: 6,
        foto_url: null,
        categoria_id: "cat-bebidas",
        disponivel: true,
      },
    ],
  },
  {
    id: "cat-vazia",
    nome: "Sobremesas",
    produtos: [],
  },
];

describe("normalizarBusca", () => {
  it("remove acento, baixa a caixa e apara as pontas", () => {
    expect(normalizarBusca("  CAFÉ  ")).toBe("cafe");
    expect(normalizarBusca("Pão")).toBe("pao");
  });

  it("NAO colapsa espaco interno (divergencia deliberada de normalizarBairro)", () => {
    expect(normalizarBusca("pao  de   queijo")).toBe("pao  de   queijo");
  });

  it("termo so com acento normaliza para vazio", () => {
    expect(normalizarBusca("́")).toBe("");
    expect(normalizarBusca("   ")).toBe("");
  });
});

describe("filtrarCatalogo", () => {
  it("'pao' casa 'Pão de queijo' e poda as categorias sem match", () => {
    const r = filtrarCatalogo(catalogo, "pao");
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("Padaria");
    expect(r[0].produtos.map((p) => p.id)).toEqual(["p1"]);
  });

  it("'CAFE' em caixa alta casa 'Café expresso'", () => {
    const r = filtrarCatalogo(catalogo, "CAFE");
    expect(r.map((c) => c.id)).toEqual(["cat-bebidas"]);
    expect(r[0].produtos.map((p) => p.id)).toEqual(["p3"]);
  });

  it("casa por descricao, nao so por nome", () => {
    const r = filtrarCatalogo(catalogo, "grao");
    expect(r.map((c) => c.id)).toEqual(["cat-bebidas"]);
  });

  it("produto com descricao null nao lanca e casa so pelo nome", () => {
    const r = filtrarCatalogo(catalogo, "broa");
    expect(r[0].produtos.map((p) => p.id)).toEqual(["p2"]);
  });

  it("termo vazio ou so com espacos devolve a MESMA referencia", () => {
    expect(filtrarCatalogo(catalogo, "")).toBe(catalogo);
    expect(filtrarCatalogo(catalogo, "   ")).toBe(catalogo);
    expect(filtrarCatalogo(catalogo, "́")).toBe(catalogo);
  });

  it("nenhum match devolve [] (a UI mostra estado vazio, nunca tela branca)", () => {
    expect(filtrarCatalogo(catalogo, "feijoada")).toEqual([]);
    expect(filtrarCatalogo([], "pao")).toEqual([]);
  });

  it("categoria sem produtos sai do resultado", () => {
    expect(filtrarCatalogo(catalogo, "a").map((c) => c.id)).not.toContain(
      "cat-vazia",
    );
  });

  it("nao muta a entrada e preserva os campos da categoria por spread", () => {
    const antes = JSON.stringify(catalogo);
    const r = filtrarCatalogo(catalogo, "cafe");
    expect(JSON.stringify(catalogo)).toBe(antes);
    expect(r[0].exibir_imagens).toBe(false);
    expect(r[0].produtos).not.toBe(catalogo[1].produtos);
  });

  it("metacaractere de regex e tratado como literal — sem match, sem excecao", () => {
    for (const termo of [".*", "a|b", "(", "[", "\\"]) {
      expect(() => filtrarCatalogo(catalogo, termo)).not.toThrow();
      expect(filtrarCatalogo(catalogo, termo)).toEqual([]);
    }
  });
});

describe("partirPorTermo", () => {
  it("preserva o acento no texto de saida", () => {
    expect(partirPorTermo("Café expresso", "cafe")).toEqual([
      { texto: "Café", casa: true },
      { texto: " expresso", casa: false },
    ]);
  });

  it("marca todas as ocorrencias, sem sobreposicao", () => {
    expect(partirPorTermo("Batata assada", "a")).toEqual([
      { texto: "B", casa: false },
      { texto: "a", casa: true },
      { texto: "t", casa: false },
      { texto: "a", casa: true },
      { texto: "t", casa: false },
      { texto: "a", casa: true },
      { texto: " ", casa: false },
      { texto: "a", casa: true },
      { texto: "ss", casa: false },
      { texto: "a", casa: true },
      { texto: "d", casa: false },
      { texto: "a", casa: true },
    ]);
  });

  it("termo vazio -> um unico segmento sem realce; texto vazio -> []", () => {
    expect(partirPorTermo("Bolo", "")).toEqual([
      { texto: "Bolo", casa: false },
    ]);
    expect(partirPorTermo("Bolo", "   ")).toEqual([
      { texto: "Bolo", casa: false },
    ]);
    expect(partirPorTermo("", "bolo")).toEqual([]);
  });

  it("termo maior que o texto ou sem match -> um segmento sem realce", () => {
    expect(partirPorTermo("Bolo", "bolo de cenoura")).toEqual([
      { texto: "Bolo", casa: false },
    ]);
  });

  it("metacaractere de regex nao lanca e nao casa", () => {
    expect(partirPorTermo("Bolo (fatia)", ".*")).toEqual([
      { texto: "Bolo (fatia)", casa: false },
    ]);
  });

  it("casa no fim da string sem emitir segmento vazio", () => {
    expect(partirPorTermo("Suco de açaí", "acai")).toEqual([
      { texto: "Suco de ", casa: false },
      { texto: "açaí", casa: true },
    ]);
    expect(
      partirPorTermo("Suco de açaí", "acai").some((p) => p.texto === ""),
    ).toBe(false);
  });
});
