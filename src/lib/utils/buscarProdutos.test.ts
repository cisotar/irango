import { describe, expect, it } from "vitest";
import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";
import {
  filtrarCatalogo,
  normalizarBusca,
  partirPorTermo,
} from "./buscarProdutos";

// RED-first: a armadilha real da issue 199 e o motivo deste modulo existir.
// Nome de produto vem frequentemente em NFD do banco ("Pão" = 4 code points:
// P, a, TIL combinante, o), enquanto a forma normalizada de busca tem 3 ("pao").
// Fatiar a string ORIGINAL com offsets da NORMALIZADA desloca o realce
// silenciosamente. IMPORTANTE: um literal "Pão" digitado direto no arquivo
// fica NFC no disco (confirmado: "Pão de queijo".normalize("NFD") !== "Pão de
// queijo"), entao NAO exercita a armadilha -- length de NFC ja bate com a
// normalizada, e ate uma implementacao ingenua passa nesse caso. Por isso
// construimos o NFD em runtime com `.normalize("NFD")`, imune a como o
// editor/git grava o arquivo.
const paoNfd = "Pão de queijo".normalize("NFD");
const cafeAcucarNfd = "Café com açúcar".normalize("NFD");
const acaiNfd = "açaí com açúcar".normalize("NFD");

describe("partirPorTermo — alinhamento de indice sob NFD genuino", () => {
  it("paoNfd é de fato NFD (pré-condição do teste, não do módulo)", () => {
    // Se isso falhar, o teste abaixo não prova nada — estaria testando NFC.
    expect(paoNfd).not.toBe("Pão de queijo".normalize("NFC"));
    expect(paoNfd.length).toBe(14); // P a TIL o (espaço) d e (espaço) q u e i j o
  });

  it("casa 'pao' em nome NFD genuino e devolve o trecho original com o TIL combinante intacto — não corta no meio do caractere", () => {
    // Uma implementação ingênua (normalizarBusca(texto).indexOf + slice com
    // offset de termo.length) corta em "Pã" + "o de queijo": o comprimento
    // total bate (a invariante de reconstrução abaixo não pegaria isso
    // sozinha), mas a fronteira do match está errada.
    const partes = partirPorTermo(paoNfd, "pao");
    expect(partes).toEqual([
      { texto: "Pão".normalize("NFD"), casa: true },
      { texto: " de queijo", casa: false },
    ]);
    // Fronteira exata: o segmento casado tem 4 UTF-16 units (P, a, TIL, o) —
    // não 2 ("Pã" da implementação ingênua).
    expect(partes[0].texto.length).toBe(4);
    expect(partes[0].texto).not.toBe("Pã".normalize("NFD"));
  });

  it("casa 'CAFE' em nome NFD com cedilha e agudo combinantes, preservando os dois acentos", () => {
    const partes = partirPorTermo(cafeAcucarNfd, "CAFE");
    expect(partes[0]).toEqual({ texto: "Café".normalize("NFD"), casa: true });
    expect(partes.map((p) => p.texto).join("")).toBe(cafeAcucarNfd);
  });

  it("multiplas ocorrencias sobre texto NFD com combinantes em ambos os lados do match", () => {
    // "açaí com açúcar" NFD: 'a' aparece solto e dentro de 'açaí'/'açúcar',
    // cada um carregando um combinante próprio (cedilha/agudo) que não deve
    // vazar para o segmento vizinho.
    const partes = partirPorTermo(acaiNfd, "a");
    expect(partes.map((p) => p.texto).join("")).toBe(acaiNfd);
    for (const p of partes) {
      if (p.casa) expect(p.texto).toBe("a");
    }
  });

  it("nao perde combinante solto na posicao 0 (nao tem caractere anterior que o absorva)", () => {
    // Achado auditar/199: `mapa[0]` sem o guard aponta para o indice do primeiro
    // caractere SOBREVIVENTE, entao um combinante inicial some do trecho.
    const texto = "́Pão";
    expect(
      partirPorTermo(texto, "pao")
        .map((p) => p.texto)
        .join(""),
    ).toBe(texto);
    const soCombinantes = "́́";
    expect(
      partirPorTermo(soCombinantes, "x")
        .map((p) => p.texto)
        .join(""),
    ).toBe(soCombinantes);
  });

  it("reconstroi a string original exatamente (sem perda nem duplicacao), incluindo NFD genuino", () => {
    const casos: [string, string][] = [
      [paoNfd, "pao"],
      [cafeAcucarNfd, "CAFE"],
      [acaiNfd, "acucar"],
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
        precoEfetivo: 5,
        temDesconto: false,
        seloDesconto: null,
        descontoFim: null,
        compravel: true,
        motivoNaoCompravel: null,
      },
      {
        id: "p2",
        nome: "Broa de milho",
        descricao: null,
        preco: 7,
        foto_url: null,
        categoria_id: "cat-padaria",
        precoEfetivo: 7,
        temDesconto: false,
        seloDesconto: null,
        descontoFim: null,
        compravel: true,
        motivoNaoCompravel: null,
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
        precoEfetivo: 6,
        temDesconto: false,
        seloDesconto: null,
        descontoFim: null,
        compravel: true,
        motivoNaoCompravel: null,
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

  it("nome de produto em NFD genuino (lojista digitando em macOS/iOS) casa termo em NFC", () => {
    const nomeNfd = "Pão de queijo".normalize("NFD");
    const catalogoNfd: CategoriaComProdutos[] = [
      {
        id: "cat-padaria-nfd",
        nome: "Padaria",
        produtos: [
          {
            id: "p-nfd",
            nome: nomeNfd,
            descricao: null,
            preco: 5,
            foto_url: null,
            categoria_id: "cat-padaria-nfd",
            precoEfetivo: 5,
            temDesconto: false,
            seloDesconto: null,
            descontoFim: null,
            compravel: true,
            motivoNaoCompravel: null,
          },
        ],
      },
    ];
    const r = filtrarCatalogo(catalogoNfd, "pão"); // termo digitado no celular, em NFC
    expect(r).toHaveLength(1);
    expect(r[0].produtos.map((p) => p.id)).toEqual(["p-nfd"]);
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
