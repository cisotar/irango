/**
 * V1 — XSS armazenado e injeção de marcação na mensagem do modal sazonal
 * (issue 304; spec modal-sazonal-mensagem-formatada.md, matriz V1, RN-M03,
 * RN-M04, RN-M05). Fase RED: o vetor é provado de ponta a ponta numa suíte só:
 *   - zod de ESCRITA (`schemaMensagemModal`);
 *   - parse na LEITURA (`lerMensagemModal`, fail-closed, log sem conteúdo);
 *   - RENDERIZADOR (`MensagemFormatada` via `renderToStaticMarkup`).
 *
 * Princípio: texto do lojista é DADO. HTML dentro de `texto` é aceito como
 * texto e sai escapado; chave fora da allowlist em QUALQUER nível reprova.
 * Sem banco nesta suíte: "linha do banco" é JSON cru passado a `lerMensagemModal`.
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

/** Corpus hostil de A1: vira TEXTO, nunca marcação. */
const CORPUS_A1 = [
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  "javascript:alert(1)",
] as const;

function docComTexto(texto: string) {
  return { versao: 1, paragrafos: [{ trechos: [{ texto }] }] };
}

function renderizar(mensagem: unknown): string {
  return renderToStaticMarkup(
    <MensagemFormatada mensagem={mensagem as MensagemModalValidada} />,
  );
}

function afirmarInerte(markup: string) {
  expect(markup).not.toMatch(/<img/i);
  expect(markup).not.toMatch(/<script/i);
  expect(markup).not.toMatch(/<a[\s>]/i);
  expect(markup).not.toMatch(/<iframe/i);
  expect(atributosPerigososEmTags(markup)).toEqual([]);
}

let spyErro: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spyErro = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  spyErro.mockRestore();
});

describe("V1-A1 — HTML/script no texto é dado, nunca marcação", () => {
  describe("zod de escrita: aceita como TEXTO e devolve idêntico", () => {
    it.each(CORPUS_A1)("aceita %j como texto de trecho, sem alterar", (texto) => {
      const r = schemaMensagemModal.safeParse(docComTexto(texto));
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data).not.toBeNull();
      expect(r.data!.paragrafos[0].trechos[0].texto).toBe(texto);
    });
  });

  describe("renderizador: texto escapado, sem tag nem atributo perigoso", () => {
    it.each(CORPUS_A1)("render de %j é inerte", (texto) => {
      const markup = renderizar(docComTexto(texto));
      afirmarInerte(markup);
    });

    it("escapa `<` do texto como &lt; e mantém o conteúdo visível", () => {
      const markup = renderizar(docComTexto("<img src=x onerror=alert(1)>"));
      expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("escapa `<script>` como texto (&lt;script&gt;)", () => {
      const markup = renderizar(docComTexto("<script>alert(1)</script>"));
      expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("`javascript:` no texto não vira link (sem <a, sem href, sem <button de link)", () => {
      const markup = renderizar(docComTexto("javascript:alert(1)"));
      expect(markup).toContain("javascript:alert(1)");
      expect(markup).not.toMatch(/<button/i);
      afirmarInerte(markup);
    });

    it("corpus inteiro no mesmo documento, em trechos com marcas, continua inerte", () => {
      const doc = {
        versao: 1,
        paragrafos: CORPUS_A1.map((texto, i) => ({
          trechos: [{ texto, negrito: true, italico: i % 2 === 0 ? true : undefined }],
        })),
      };
      const markup = renderizar(doc);
      afirmarInerte(markup);
      expect(markup).toContain("&lt;img");
      expect(markup).toContain("&lt;script&gt;");
    });
  });

  describe("leitura: o mesmo corpus gravado direto no banco continua inerte", () => {
    it.each(CORPUS_A1)("JSON cru com %j passa por lerMensagemModal e renderiza inerte", (texto) => {
      const cru: unknown = JSON.parse(JSON.stringify(docComTexto(texto)));
      const lida = lerMensagemModal(cru, CTX);
      expect(lida).not.toBeNull();
      expect(lida!.paragrafos[0].trechos[0].texto).toBe(texto);
      afirmarInerte(renderizar(lida));
      // documento válido não gera log de "mensagem inválida"
      expect(spyErro).not.toHaveBeenCalled();
    });
  });
});

/** A2: chaves fora da allowlist, cada uma num caso. */
const CHAVES_A2 = [
  "href",
  "style",
  "class",
  "target",
  "rel",
  "dangerouslySetInnerHTML",
  "__proto__",
  "constructor",
] as const;

const NIVEIS = ["documento", "paragrafo", "trecho"] as const;

/**
 * Valor JSON hostil por chave (texto JSON, para `JSON.parse`). Map, e não
 * literal de objeto: `{ __proto__: "x" }` num literal troca o protótipo em vez
 * de criar a chave, e o lookup devolveria `Object.prototype`.
 */
const VALOR_JSON = new Map<(typeof CHAVES_A2)[number], string>(Object.entries({
  href: '"javascript:alert(1)"',
  style: '"position:fixed;inset:0;z-index:9999"',
  class: '"fixed inset-0 z-50"',
  target: '"_top"',
  rel: '"opener"',
  dangerouslySetInnerHTML: '{"__html":"<img src=x onerror=alert(1)>"}',
  constructor: '{"prototype":{"poluido":true}}',
}) as Array<[(typeof CHAVES_A2)[number], string]>);
VALOR_JSON.set("__proto__", '{"poluido":true}');

/**
 * Monta o documento como TEXTO JSON e passa por `JSON.parse`: é o único jeito
 * de `__proto__`/`constructor` virarem propriedade PRÓPRIA (um literal de
 * objeto `{ __proto__: x }` troca o protótipo em vez de criar a chave).
 */
function jsonComChaveExtra(
  nivel: (typeof NIVEIS)[number],
  chave: (typeof CHAVES_A2)[number],
): unknown {
  const extra = `,"${chave}":${VALOR_JSON.get(chave)}`;
  const trecho = `{"texto":"Promoção de hoje"${nivel === "trecho" ? extra : ""}}`;
  const paragrafo = `{"trechos":[${trecho}]${nivel === "paragrafo" ? extra : ""}}`;
  const doc = `{"versao":1,"paragrafos":[${paragrafo}]${nivel === "documento" ? extra : ""}}`;
  return JSON.parse(doc);
}

const CASOS_A2 = NIVEIS.flatMap((nivel) =>
  CHAVES_A2.map((chave) => [nivel, chave] as const),
);

describe("V1-A2 — chave extra em qualquer nível reprova (.strict())", () => {
  it("controle: o mesmo documento SEM chave extra é aceito", () => {
    const base = JSON.parse(
      '{"versao":1,"paragrafos":[{"trechos":[{"texto":"Promoção de hoje"}]}]}',
    );
    expect(schemaMensagemModal.safeParse(base).success).toBe(true);
    expect(lerMensagemModal(base, CTX)).not.toBeNull();
  });

  it.each(CASOS_A2)("zod de escrita reprova %s com chave %s", (nivel, chave) => {
    const cru = jsonComChaveExtra(nivel, chave);
    // pré-condição: a chave É propriedade própria (JSON.parse), não protótipo
    const alvo =
      nivel === "documento"
        ? cru
        : nivel === "paragrafo"
          ? (cru as { paragrafos: unknown[] }).paragrafos[0]
          : (cru as { paragrafos: { trechos: unknown[] }[] }).paragrafos[0].trechos[0];
    expect(Object.hasOwn(alvo as object, chave)).toBe(true);

    expect(schemaMensagemModal.safeParse(cru).success).toBe(false);
  });

  it.each(CASOS_A2)(
    "leitura: lerMensagemModal devolve null para %s com chave %s e loga só {lojaId, modalId}",
    (nivel, chave) => {
      const cru = jsonComChaveExtra(nivel, chave);
      expect(lerMensagemModal(cru, CTX)).toBeNull();

      expect(spyErro).toHaveBeenCalledTimes(1);
      const [mensagemLog, contexto, ...resto] = spyErro.mock.calls[0];
      expect(mensagemLog).toBe("[modalSazonal] mensagem inválida");
      expect(resto).toEqual([]);
      expect(Object.keys(contexto as object).sort()).toEqual(["lojaId", "modalId"]);
      expect(contexto).toEqual(CTX);
      // nenhum conteúdo do documento vaza para o log
      const logado = JSON.stringify(spyErro.mock.calls);
      expect(logado).not.toContain("Promoção de hoje");
      expect(logado).not.toContain("alert");
    },
  );

  it("parse de __proto__/constructor não polui Object.prototype", () => {
    for (const nivel of NIVEIS) {
      schemaMensagemModal.safeParse(jsonComChaveExtra(nivel, "__proto__"));
      schemaMensagemModal.safeParse(jsonComChaveExtra(nivel, "constructor"));
      lerMensagemModal(jsonComChaveExtra(nivel, "__proto__"), CTX);
    }
    expect(({} as Record<string, unknown>).poluido).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).poluido).toBeUndefined();
  });

  it("render forçado (cast) com dangerouslySetInnerHTML no trecho não injeta HTML", () => {
    const forcado = jsonComChaveExtra("trecho", "dangerouslySetInnerHTML");
    const markup = renderizar(forcado);
    afirmarInerte(markup);
    expect(markup).toContain("Promoção de hoje");
  });

  it("render forçado com href/style/class/target no trecho não emite o atributo", () => {
    const forcado = {
      versao: 1,
      paragrafos: [
        {
          style: "position:fixed",
          trechos: [
            {
              texto: "Promoção de hoje",
              href: "javascript:alert(1)",
              style: "position:fixed",
              class: "fixed inset-0",
              target: "_top",
            },
          ],
        },
      ],
    };
    const markup = renderizar(forcado);
    afirmarInerte(markup);
    expect(markup).not.toContain("_top");
    expect(markup).not.toContain("inset-0");
  });
});
