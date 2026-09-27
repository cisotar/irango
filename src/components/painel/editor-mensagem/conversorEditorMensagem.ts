import type { JSONContent } from "@tiptap/core";

import { CORES_MENSAGEM } from "@/lib/constants/paletaMensagem";
import {
  FONTES_TRECHO,
  TAMANHOS_TRECHO,
  type Alinhamento,
  type CorTrecho,
  type FonteTrecho,
  type MensagemModalValidada,
  type TamanhoTrecho,
  type TipoParagrafo,
} from "@/lib/validacoes/mensagemModal";

/**
 * Tradução entre o JSON do ProseMirror (editor do painel) e o formato iRango
 * da mensagem (spec modal-sazonal-mensagem-formatada, §Painel). Módulo puro,
 * testável em `environment: node`.
 *
 * NÃO é fronteira de confiança: a saída de `documentoEditorParaMensagem` passa
 * pelo `schemaMensagemModal` no form (UX) e na Server Action (autoridade). Ainda
 * assim é defensivo: ignora nó e mark fora da allowlist, lê só chaves próprias,
 * e ACHATA lista aninhada (o editor não deixa criar, mas o JSON é `unknown`).
 * Sem recursão: a árvore é percorrida com pilha explícita e teto de nós.
 */

/** Trecho como sai do editor (forma bruta aceita por `schemaMensagemModal`). */
export type TrechoDoEditor = {
  texto: string;
  negrito?: true;
  italico?: true;
  sublinhado?: true;
  tachado?: true;
  tamanho?: TamanhoTrecho;
  cor?: CorTrecho;
  fonte?: FonteTrecho;
  link?: string;
};

export type ParagrafoDoEditor = {
  tipo?: TipoParagrafo;
  alinhamento?: Alinhamento;
  trechos: TrechoDoEditor[];
};

/** Documento bruto do editor, ainda NÃO validado. */
export type MensagemDoEditor = { versao: 1; paragrafos: ParagrafoDoEditor[] };

/** Teto de nós visitados: um JSON hostil não trava a aba. */
const TETO_NOS_VISITADOS = 20_000;

function campo(obj: unknown, chave: string): unknown {
  return typeof obj === "object" && obj !== null && Object.hasOwn(obj, chave)
    ? (obj as Record<string, unknown>)[chave]
    : undefined;
}

function filhos(no: unknown): readonly unknown[] {
  const c = campo(no, "content");
  return Array.isArray(c) ? c : [];
}

function doEnum<T extends string>(lista: readonly T[], valor: unknown): T | undefined {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor)
    ? (valor as T)
    : undefined;
}

function alinhamentoDoEditor(no: unknown): Alinhamento | undefined {
  const a = campo(campo(no, "attrs"), "textAlign");
  if (a === "center") return "centro";
  if (a === "right") return "direita";
  return undefined;
}

function trechoDoTexto(no: unknown): TrechoDoEditor | null {
  const texto = campo(no, "text");
  if (typeof texto !== "string" || texto === "") return null;
  const trecho: TrechoDoEditor = { texto };
  const marks = campo(no, "marks");
  if (!Array.isArray(marks)) return trecho;
  for (const mark of marks) {
    const valor = campo(campo(mark, "attrs"), "valor");
    switch (campo(mark, "type")) {
      case "bold":
        trecho.negrito = true;
        break;
      case "italic":
        trecho.italico = true;
        break;
      case "underline":
        trecho.sublinhado = true;
        break;
      case "strike":
        trecho.tachado = true;
        break;
      case "link": {
        const href = campo(campo(mark, "attrs"), "href");
        if (typeof href === "string") trecho.link = href;
        break;
      }
      case "tamanho": {
        const v = doEnum(TAMANHOS_TRECHO, valor);
        if (v !== undefined) trecho.tamanho = v;
        break;
      }
      case "cor": {
        const v = doEnum(CORES_MENSAGEM, valor);
        if (v !== undefined) trecho.cor = v;
        break;
      }
      case "fonte": {
        const v = doEnum(FONTES_TRECHO, valor);
        if (v !== undefined) trecho.fonte = v;
        break;
      }
      default:
        // mark fora da allowlist: ignorada.
        break;
    }
  }
  return trecho;
}

/** Trechos do conteúdo INLINE de um bloco (só nós `text`; o resto é ignorado). */
function trechosDoBloco(bloco: unknown): TrechoDoEditor[] {
  const trechos: TrechoDoEditor[] = [];
  for (const inline of filhos(bloco)) {
    if (campo(inline, "type") !== "text") continue;
    const t = trechoDoTexto(inline);
    if (t !== null) trechos.push(t);
  }
  return trechos;
}

type Pendente = { no: unknown; lista: TipoParagrafo | undefined };

/**
 * JSON do editor → formato iRango bruto. Blocos aceitos: `paragraph`,
 * `heading` (vira `tipo: "titulo"`), `bulletList`/`orderedList` com `listItem`.
 * Qualquer outro nó é descartado com a subárvore. Parágrafo dentro de lista
 * vira item do tipo da lista mais próxima; lista dentro de lista é achatada.
 */
export function documentoEditorParaMensagem(doc: unknown): MensagemDoEditor {
  const paragrafos: ParagrafoDoEditor[] = [];
  if (campo(doc, "type") !== "doc") return { versao: 1, paragrafos };

  // Pilha em ordem inversa para visitar os blocos na ordem do documento.
  const pilha: Pendente[] = filhos(doc)
    .map((no) => ({ no, lista: undefined }))
    .reverse();
  let visitados = 0;

  while (pilha.length > 0 && visitados < TETO_NOS_VISITADOS) {
    const { no, lista } = pilha.pop() as Pendente;
    visitados++;
    const tipoNo = campo(no, "type");

    if (tipoNo === "paragraph" || tipoNo === "heading") {
      const paragrafo: ParagrafoDoEditor = { trechos: trechosDoBloco(no) };
      if (lista !== undefined) paragrafo.tipo = lista;
      else if (tipoNo === "heading") paragrafo.tipo = "titulo";
      const alinhamento = alinhamentoDoEditor(no);
      if (alinhamento !== undefined) paragrafo.alinhamento = alinhamento;
      paragrafos.push(paragrafo);
      continue;
    }

    let proximaLista: TipoParagrafo | undefined;
    if (tipoNo === "bulletList") proximaLista = "item-lista";
    else if (tipoNo === "orderedList") proximaLista = "item-numerado";
    else if (tipoNo === "listItem" && lista !== undefined) proximaLista = lista;
    else continue; // nó fora da allowlist (ou listItem solto): descartado.

    const internos = filhos(no);
    for (let i = internos.length - 1; i >= 0; i--) {
      pilha.push({ no: internos[i], lista: proximaLista });
    }
  }

  return { versao: 1, paragrafos };
}

const ALINHAMENTO_PARA_EDITOR: Readonly<Record<Alinhamento, string>> = Object.freeze({
  centro: "center",
  direita: "right",
});

function textoParaEditor(t: MensagemModalValidada["paragrafos"][number]["trechos"][number]): JSONContent {
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (t.negrito === true) marks.push({ type: "bold" });
  if (t.italico === true) marks.push({ type: "italic" });
  if (t.sublinhado === true) marks.push({ type: "underline" });
  if (t.tachado === true) marks.push({ type: "strike" });
  if (t.tamanho !== undefined) marks.push({ type: "tamanho", attrs: { valor: t.tamanho } });
  if (t.cor !== undefined) marks.push({ type: "cor", attrs: { valor: t.cor } });
  if (t.fonte !== undefined) marks.push({ type: "fonte", attrs: { valor: t.fonte } });
  if (t.link !== undefined) marks.push({ type: "link", attrs: { href: t.link } });
  const no: JSONContent = { type: "text", text: t.texto };
  if (marks.length > 0) no.marks = marks;
  return no;
}

function blocoParaEditor(
  p: MensagemModalValidada["paragrafos"][number],
  tipo: "paragraph" | "heading",
): JSONContent {
  const bloco: JSONContent = { type: tipo };
  const attrs: Record<string, unknown> = {};
  if (tipo === "heading") attrs.level = 2;
  if (p.alinhamento !== undefined) attrs.textAlign = ALINHAMENTO_PARA_EDITOR[p.alinhamento];
  if (Object.keys(attrs).length > 0) bloco.attrs = attrs;
  if (p.trechos.length > 0) bloco.content = p.trechos.map(textoParaEditor);
  return bloco;
}

/**
 * Formato iRango validado → JSON do editor (conteúdo inicial; NUNCA string
 * HTML). Itens consecutivos do mesmo tipo de lista voltam a ser UMA lista.
 */
export function mensagemParaDocumentoEditor(m: MensagemModalValidada | null): JSONContent {
  if (m === null) return { type: "doc", content: [{ type: "paragraph" }] };

  const content: JSONContent[] = [];
  for (const p of m.paragrafos) {
    if (p.tipo === "item-lista" || p.tipo === "item-numerado") {
      const tipoLista = p.tipo === "item-lista" ? "bulletList" : "orderedList";
      const item: JSONContent = { type: "listItem", content: [blocoParaEditor(p, "paragraph")] };
      const anterior = content[content.length - 1];
      if (anterior !== undefined && anterior.type === tipoLista && anterior.content !== undefined) {
        anterior.content.push(item);
      } else {
        content.push({ type: tipoLista, content: [item] });
      }
      continue;
    }
    content.push(blocoParaEditor(p, p.tipo === "titulo" ? "heading" : "paragraph"));
  }
  return { type: "doc", content };
}
