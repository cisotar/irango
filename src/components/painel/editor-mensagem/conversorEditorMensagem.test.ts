/**
 * [315] Conversor editor ⇄ formato iRango (spec modal-sazonal-mensagem-formatada,
 * §Painel). `environment: node`: o schema do ProseMirror é montado das MESMAS
 * extensões do editor (`criarExtensoesMensagem`) e o JSON é conferido contra ele.
 */

import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { schemaMensagemModal, type MensagemModalValidada } from "@/lib/validacoes/mensagemModal";
import {
  documentoEditorParaMensagem,
  mensagemParaDocumentoEditor,
} from "./conversorEditorMensagem";
import { criarExtensoesMensagem } from "./extensoesEditorMensagem";

const schemaEditor = getSchema(criarExtensoesMensagem());

function validar(bruto: unknown): MensagemModalValidada | null {
  const r = schemaMensagemModal.safeParse(bruto);
  if (!r.success) throw new Error(`zod reprovou: ${r.error.issues[0]?.message}`);
  return r.data;
}

const texto = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });

describe("documentoEditorParaMensagem", () => {
  it("traduz parágrafo, título, marcas, marks próprias, link e alinhamento", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [texto("Inverno")] },
        {
          type: "paragraph",
          attrs: { textAlign: "right" },
          content: [
            texto("forte", [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }]),
            texto(" grande", [{ type: "tamanho", attrs: { valor: "grande" } }]),
            texto(" verde", [{ type: "cor", attrs: { valor: "verde" } }]),
            texto(" mono", [{ type: "fonte", attrs: { valor: "mono" } }]),
            texto(" site", [{ type: "link", attrs: { href: "https://exemplo.com.br/x" } }]),
          ],
        },
      ],
    };
    expect(documentoEditorParaMensagem(doc)).toEqual({
      versao: 1,
      paragrafos: [
        { tipo: "titulo", alinhamento: "centro", trechos: [{ texto: "Inverno" }] },
        {
          alinhamento: "direita",
          trechos: [
            { texto: "forte", negrito: true, italico: true, sublinhado: true, tachado: true },
            { texto: " grande", tamanho: "grande" },
            { texto: " verde", cor: "verde" },
            { texto: " mono", fonte: "mono" },
            { texto: " site", link: "https://exemplo.com.br/x" },
          ],
        },
      ],
    });
  });

  it("ignora nó e mark fora da allowlist e valor de mark fora do enum", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "blockquote", content: [{ type: "paragraph", content: [texto("citação")] }] },
        { type: "codeBlock", content: [texto("<script>")] },
        { type: "image", attrs: { src: "https://x.com/a.png" } },
        {
          type: "paragraph",
          attrs: { textAlign: "justify", style: "color:red" },
          content: [
            texto("a", [
              { type: "textStyle", attrs: { color: "#f00" } },
              { type: "cor", attrs: { valor: "#ff0000" } },
              { type: "tamanho", attrs: { valor: "72px" } },
              { type: "fonte", attrs: { valor: "Comic Sans" } },
              { type: "code" },
            ]),
            { type: "hardBreak" },
            { type: "mention", attrs: { id: "x" } },
          ],
        },
      ],
    };
    expect(documentoEditorParaMensagem(doc)).toEqual({
      versao: 1,
      paragrafos: [{ trechos: [{ texto: "a" }] }],
    });
  });

  it("achata lista aninhada (lado editor de A22): cada parágrafo vira um item plano", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [texto("um")] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [texto("um.um")] },
                        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [texto("fundo")] }] }] },
                      ],
                    },
                  ],
                },
              ],
            },
            { type: "listItem", content: [{ type: "paragraph", content: [texto("dois")] }] },
          ],
        },
      ],
    };
    const m = documentoEditorParaMensagem(doc);
    expect(m.paragrafos).toEqual([
      { tipo: "item-lista", trechos: [{ texto: "um" }] },
      { tipo: "item-numerado", trechos: [{ texto: "um.um" }] },
      { tipo: "item-lista", trechos: [{ texto: "fundo" }] },
      { tipo: "item-lista", trechos: [{ texto: "dois" }] },
    ]);
    // Nenhum campo de nível/filho: o zod aceita a forma plana.
    expect(validar(m)).not.toBeNull();
  });

  it("lê só chaves próprias e devolve documento vazio para lixo", () => {
    expect(documentoEditorParaMensagem(null)).toEqual({ versao: 1, paragrafos: [] });
    expect(documentoEditorParaMensagem("<p>oi</p>")).toEqual({ versao: 1, paragrafos: [] });
    const herdado = Object.create({ type: "doc", content: [{ type: "paragraph", content: [texto("x")] }] });
    expect(documentoEditorParaMensagem(herdado)).toEqual({ versao: 1, paragrafos: [] });
  });

  it("documento só com parágrafo vazio vira `null` no zod (apagar a mensagem)", () => {
    const m = documentoEditorParaMensagem(mensagemParaDocumentoEditor(null));
    expect(validar(m)).toBeNull();
  });

  it("emoji com ZWJ atravessa inteiro", () => {
    const familia = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const m = validar(
      documentoEditorParaMensagem({ type: "doc", content: [{ type: "paragraph", content: [texto(`Oi ${familia}`)] }] }),
    );
    expect(m?.paragrafos[0].trechos[0].texto).toBe(`Oi ${familia}`);
  });
});

describe("mensagemParaDocumentoEditor", () => {
  const mensagem = validar({
    versao: 1,
    paragrafos: [
      { tipo: "titulo", alinhamento: "centro", trechos: [{ texto: "Chegou o inverno", negrito: true }] },
      {
        trechos: [
          { texto: "Sopas ", tamanho: "grande", cor: "vermelho" },
          { texto: "e caldos", italico: true, fonte: "serifa", tachado: true, sublinhado: true },
        ],
      },
      { trechos: [] },
      { tipo: "item-lista", trechos: [{ texto: "Canja" }] },
      { tipo: "item-lista", alinhamento: "direita", trechos: [{ texto: "Sopa de ervilha" }] },
      { tipo: "item-numerado", trechos: [{ texto: "Peça" }] },
      { tipo: "item-numerado", trechos: [{ texto: "Receba", fonte: "mono" }] },
      { trechos: [{ texto: "Saiba mais", link: "https://exemplo.com.br/inverno" }] },
    ],
  }) as MensagemModalValidada;

  it("itens consecutivos do mesmo tipo voltam a ser UMA lista do editor", () => {
    const doc = mensagemParaDocumentoEditor(mensagem);
    const tipos = (doc.content ?? []).map((n) => n.type);
    expect(tipos).toEqual(["heading", "paragraph", "paragraph", "bulletList", "orderedList", "paragraph"]);
    expect(doc.content?.[3].content).toHaveLength(2);
    expect(doc.content?.[4].content).toHaveLength(2);
  });

  it("o JSON produzido é válido no schema do editor (título nível 2, item com um parágrafo)", () => {
    const no = schemaEditor.nodeFromJSON(mensagemParaDocumentoEditor(mensagem));
    expect(() => no.check()).not.toThrow();
    expect(() => schemaEditor.nodeFromJSON(mensagemParaDocumentoEditor(null)).check()).not.toThrow();
  });

  it("ida e volta é estável depois do zod", () => {
    const volta = validar(documentoEditorParaMensagem(mensagemParaDocumentoEditor(mensagem)));
    expect(volta).toEqual(mensagem);
    // e de novo, sem deriva.
    expect(validar(documentoEditorParaMensagem(mensagemParaDocumentoEditor(volta)))).toEqual(mensagem);
  });

  it("ida e volta passando pelo schema do ProseMirror (o que o editor devolve em getJSON)", () => {
    const pm = schemaEditor.nodeFromJSON(mensagemParaDocumentoEditor(mensagem));
    expect(validar(documentoEditorParaMensagem(pm.toJSON()))).toEqual(mensagem);
  });
});

describe("schema do editor (allowlist)", () => {
  it("lista aninhada é impossível: listItem só aceita um parágrafo", () => {
    const aninhada = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [texto("a")] },
                { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(() => schemaEditor.nodeFromJSON(aninhada).check()).toThrow();
  });

  it("só existem os nós e marks da allowlist", () => {
    expect(Object.keys(schemaEditor.nodes).sort()).toEqual(
      ["bulletList", "doc", "heading", "listItem", "orderedList", "paragraph", "text"].sort(),
    );
    expect(Object.keys(schemaEditor.marks).sort()).toEqual(
      ["bold", "cor", "fonte", "italic", "link", "strike", "tamanho", "underline"].sort(),
    );
  });

  it("as marks próprias não leem HTML (parseHTML vazio)", () => {
    for (const nome of ["tamanho", "cor", "fonte"]) {
      expect(schemaEditor.marks[nome].spec.parseDOM ?? []).toEqual([]);
    }
  });
});
