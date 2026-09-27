/**
 * V3 — CSS e enum forçado na mensagem do modal sazonal (issue 306; spec
 * modal-sazonal-mensagem-formatada.md, matriz V3, RN-M03, RN-M05, RN-M13,
 * RN-M14). Fase RED.
 *
 * Para cada valor hostil de tamanho, marca, cor, fonte, tipo e alinhamento:
 *   (a) `schemaMensagemModal` reprova (enum fechado / `z.literal(true)` / `.strict()`);
 *   (b) `lerMensagemModal` devolve `null` (mesmo JSON "lido do banco");
 *   (c) render FORÇADO (cast, contornando o zod) não emite `style`, classe
 *       derivada do valor, `<link>`, `@font-face` nem heading.
 *
 * A prova mais forte de (c) é a IGUALDADE com o render do documento-base sem o
 * atributo: valor desconhecido não gera classe nenhuma (`Object.hasOwn`, não
 * `MAPA[valor]`: `MAPA["constructor"]` devolveria uma função).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MensagemFormatada } from "@/components/shared/MensagemFormatada";
import {
  lerMensagemModal,
  schemaMensagemModal,
  type MensagemModalValidada,
} from "@/lib/validacoes/mensagemModal";

import { atributosPerigososEmTags } from "./markup";

const CTX = {
  lojaId: "11111111-1111-4111-8111-111111111111",
  modalId: "22222222-2222-4222-8222-222222222222",
};

const TEXTO = "Oferta da semana";

type TrechoLivre = Record<string, unknown>;
type ParagrafoLivre = Record<string, unknown>;

function docTrecho(extra: TrechoLivre = {}) {
  return { versao: 1, paragrafos: [{ trechos: [{ texto: TEXTO, ...extra }] }] };
}
function docParagrafo(extra: ParagrafoLivre = {}) {
  return { versao: 1, paragrafos: [{ ...extra, trechos: [{ texto: TEXTO }] }] };
}

function renderizar(mensagem: unknown): string {
  return renderToStaticMarkup(
    <MensagemFormatada mensagem={mensagem as MensagemModalValidada} />,
  );
}

const BASE_MARKUP = () => renderizar(docTrecho());

function afirmarSemCssInjetado(markup: string, literal: string) {
  expect(atributosPerigososEmTags(markup)).toEqual([]);
  expect(markup).not.toMatch(/<style/i);
  expect(markup).not.toMatch(/<link/i);
  expect(markup).not.toMatch(/@font-face/i);
  expect(markup).not.toMatch(/@import/i);
  // Palavra curta e comum ("red", "left") pode aparecer legitimamente em outra
  // classe do contêiner; para essas, a prova é a igualdade com o render base.
  if (!/^[a-z]+$/i.test(literal) || literal === "constructor") {
    expect(markup).not.toContain(literal);
  }
}

let spyErro: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spyErro = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  spyErro.mockRestore();
});

/** Casos de atributo de TRECHO com valor hostil (A3, A19, A20). */
const CASOS_TRECHO: Array<[string, string, string]> = [
  ["A3", "tamanho", "999px"],
  ["A3", "tamanho", "constructor"],
  ["A3", "tamanho", "x;position:fixed"],
  ["A19", "cor", "#ff0000"],
  ["A19", "cor", "rgb(0,0,0)"],
  ["A19", "cor", "red"],
  ["A19", "cor", "marrom; background:url(//x)"],
  ["A19", "cor", "constructor"],
  ["A20", "fonte", "Comic Sans MS"],
  ["A20", "fonte", "url(https://golpe.com/f.woff)"],
  ["A20", "fonte", "serif; @import"],
];

describe("V3-A3/A19/A20 — tamanho, cor e fonte fora do enum", () => {
  it.each(CASOS_TRECHO)("%s zod reprova %s=%j", (_a, campo, valor) => {
    expect(schemaMensagemModal.safeParse(docTrecho({ [campo]: valor })).success).toBe(false);
  });

  it.each(CASOS_TRECHO)("%s lerMensagemModal devolve null para %s=%j", (_a, campo, valor) => {
    const cru: unknown = JSON.parse(JSON.stringify(docTrecho({ [campo]: valor })));
    expect(lerMensagemModal(cru, CTX)).toBeNull();
  });

  it.each(CASOS_TRECHO)(
    "%s render forçado com %s=%j: sem style/classe/<link>/@font-face, idêntico ao base",
    (_a, campo, valor) => {
      const markup = renderizar(docTrecho({ [campo]: valor }));
      afirmarSemCssInjetado(markup, valor);
      expect(markup).toContain(TEXTO);
      expect(markup).toBe(BASE_MARKUP());
    },
  );

  it("render forçado com cor=\"constructor\" não lança (Object.hasOwn, não MAPA[valor])", () => {
    expect(() => renderizar(docTrecho({ cor: "constructor", tamanho: "constructor", fonte: "constructor" }))).not.toThrow();
  });

  it("render forçado com __proto__/toString como valor de enum não gera classe", () => {
    for (const valor of ["__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      const markup = renderizar(docTrecho({ cor: valor, tamanho: valor, fonte: valor }));
      expect(markup).toBe(BASE_MARKUP());
    }
  });
});

/** A4: marca não booleana. */
const MARCAS: Array<[string, RegExp]> = [
  ["negrito", /<strong/i],
  ["italico", /<em[\s>]/i],
  ["tachado", /<s[\s>]/i],
  ["sublinhado", /underline/i],
];
const VALORES_NAO_BOOLEANOS: unknown[] = ["true", 1, {}];

const CASOS_A4 = MARCAS.flatMap(([marca, marcador]) =>
  VALORES_NAO_BOOLEANOS.map((valor) => [marca, valor, marcador] as const),
);

describe("V3-A4 — marca booleana só com `true` literal", () => {
  it.each(CASOS_A4)("zod reprova %s=%j", (marca, valor) => {
    expect(schemaMensagemModal.safeParse(docTrecho({ [marca]: valor })).success).toBe(false);
  });

  it.each(CASOS_A4)("lerMensagemModal devolve null para %s=%j", (marca, valor) => {
    expect(lerMensagemModal(docTrecho({ [marca]: valor }), CTX)).toBeNull();
  });

  it.each(CASOS_A4)("render forçado com %s=%j não aplica a marca", (marca, valor, marcador) => {
    const markup = renderizar(docTrecho({ [marca]: valor }));
    expect(markup).not.toMatch(marcador);
    expect(markup).toBe(BASE_MARKUP());
  });

  it.each(MARCAS)("controle: %s=true aplica a marca no render", (marca, marcador) => {
    expect(renderizar(docTrecho({ [marca]: true }))).toMatch(marcador);
  });
});

/** A21: tipo de bloco conflitante ou fora do enum. */
const CASOS_A21_ZOD: Array<[string, ParagrafoLivre]> = [
  ['{tipo:"titulo", lista:true}', { tipo: "titulo", lista: true }],
  ['{titulo:true, tipo:"item-lista"}', { titulo: true, tipo: "item-lista" }],
  ['tipo:"h1"', { tipo: "h1" }],
  ['tipo:"script"', { tipo: "script" }],
];

describe("V3-A21 — tipo de bloco: enum único, sem heading", () => {
  it.each(CASOS_A21_ZOD)("zod reprova %s", (_nome, extra) => {
    expect(schemaMensagemModal.safeParse(docParagrafo(extra)).success).toBe(false);
  });

  it.each(CASOS_A21_ZOD)("lerMensagemModal devolve null para %s", (_nome, extra) => {
    expect(lerMensagemModal(docParagrafo(extra), CTX)).toBeNull();
  });

  it("render forçado com tipo:\"h1\" não emite <h1>..<h6>", () => {
    const markup = renderizar(docParagrafo({ tipo: "h1" }));
    expect(markup).not.toMatch(/<h[1-6][\s>]/i);
    expect(markup).not.toContain("h1");
    expect(markup).toContain(TEXTO);
  });

  it("render forçado com tipo:\"script\" não emite <script", () => {
    const markup = renderizar(docParagrafo({ tipo: "script" }));
    expect(markup).not.toMatch(/<script/i);
    expect(markup).toContain(TEXTO);
  });

  it("tipo:\"titulo\" válido renderiza <p>, nunca heading", () => {
    const markup = renderizar(docParagrafo({ tipo: "titulo" }));
    expect(markup).toMatch(/<p[\s>]/i);
    expect(markup).not.toMatch(/<h[1-6][\s>]/i);
    expect(markup).toContain(TEXTO);
  });

  it("item-lista forma <ul><li>, item-numerado forma <ol><li> sem start/type/value", () => {
    const markup = renderizar({
      versao: 1,
      paragrafos: [
        { tipo: "item-lista", trechos: [{ texto: "um" }] },
        { tipo: "item-lista", trechos: [{ texto: "dois" }] },
        { tipo: "item-numerado", trechos: [{ texto: "tres" }] },
      ],
    });
    expect(markup.match(/<ul[\s>]/g) ?? []).toHaveLength(1);
    expect(markup.match(/<ol[\s>]/g) ?? []).toHaveLength(1);
    expect(markup.match(/<li[\s>]/g) ?? []).toHaveLength(3);
    expect(markup).not.toMatch(/<ol[^>]*\s(start|type)=/i);
    expect(markup).not.toMatch(/<li[^>]*\svalue=/i);
  });
});

/** A23: alinhamento fora do enum. */
const CASOS_A23 = ["justify; position:fixed", "left", "constructor"];

describe("V3-A23 — alinhamento fora do enum", () => {
  const BASE_PARAGRAFO = () => renderizar(docParagrafo());

  it.each(CASOS_A23)("zod reprova alinhamento=%j", (valor) => {
    expect(schemaMensagemModal.safeParse(docParagrafo({ alinhamento: valor })).success).toBe(false);
  });

  it.each(CASOS_A23)("lerMensagemModal devolve null para alinhamento=%j", (valor) => {
    expect(lerMensagemModal(docParagrafo({ alinhamento: valor }), CTX)).toBeNull();
  });

  it.each(CASOS_A23)("render forçado com alinhamento=%j: sem style/classe, idêntico ao base", (valor) => {
    const markup = renderizar(docParagrafo({ alinhamento: valor }));
    afirmarSemCssInjetado(markup, valor);
    expect(markup).toBe(BASE_PARAGRAFO());
  });
});

describe("V3 — controle positivo: enums válidos aceitos, padrões canonizados para ausente (RN-M03)", () => {
  it("valores-padrão (normal/automatica/padrao/paragrafo/esquerda, marcas false) viram ausentes", () => {
    const r = schemaMensagemModal.safeParse({
      versao: 1,
      paragrafos: [
        {
          tipo: "paragrafo",
          alinhamento: "esquerda",
          trechos: [
            {
              texto: TEXTO,
              negrito: false,
              italico: false,
              sublinhado: false,
              tachado: false,
              tamanho: "normal",
              cor: "automatica",
              fonte: "padrao",
            },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toStrictEqual({
      versao: 1,
      paragrafos: [{ trechos: [{ texto: TEXTO }] }],
    });
  });

  it.each([
    ["tamanho", ["pequeno", "grande", "enorme"]],
    ["cor", ["marrom", "vermelho", "laranja", "verde", "azul", "roxo", "cinza"]],
    ["fonte", ["serifa", "mono"]],
  ] as const)("%s: todo valor do enum é aceito e preservado", (campo, valores) => {
    for (const valor of valores) {
      const r = schemaMensagemModal.safeParse(docTrecho({ [campo]: valor }));
      expect(r.success, `${campo}=${valor}`).toBe(true);
      if (!r.success) continue;
      expect((r.data!.paragrafos[0].trechos[0] as TrechoLivre)[campo]).toBe(valor);
    }
  });

  it.each([
    ["tipo", ["titulo", "item-lista", "item-numerado"]],
    ["alinhamento", ["centro", "direita"]],
  ] as const)("%s: todo valor do enum é aceito e preservado", (campo, valores) => {
    for (const valor of valores) {
      const r = schemaMensagemModal.safeParse(docParagrafo({ [campo]: valor }));
      expect(r.success, `${campo}=${valor}`).toBe(true);
      if (!r.success) continue;
      expect((r.data!.paragrafos[0] as ParagrafoLivre)[campo]).toBe(valor);
    }
  });

  it("marcas true são preservadas", () => {
    const r = schemaMensagemModal.safeParse(
      docTrecho({ negrito: true, italico: true, sublinhado: true, tachado: true }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data!.paragrafos[0].trechos[0]).toStrictEqual({
      texto: TEXTO,
      negrito: true,
      italico: true,
      sublinhado: true,
      tachado: true,
    });
  });

  it("versao desconhecida reprova e a leitura descarta", () => {
    const doc = { versao: 2, paragrafos: [{ trechos: [{ texto: TEXTO }] }] };
    expect(schemaMensagemModal.safeParse(doc).success).toBe(false);
    expect(lerMensagemModal(doc, CTX)).toBeNull();
  });
});
