import { Mark, mergeAttributes, type AnyExtension } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { UndoRedo } from "@tiptap/extensions/undo-redo";

import {
  CLASSE_COR_LINK_MENSAGEM,
  CLASSES_COR_MENSAGEM,
  CLASSES_FONTE_MENSAGEM,
  CLASSES_TAMANHO_MENSAGEM,
  CORES_MENSAGEM,
} from "@/lib/constants/paletaMensagem";
import { urlLinkExternoSegura } from "@/lib/utils/urlLinkExternoSegura";
import { FONTES_TRECHO, TAMANHOS_TRECHO } from "@/lib/validacoes/mensagemModal";

/**
 * Extensões do editor da mensagem do modal sazonal (spec
 * modal-sazonal-mensagem-formatada, §Painel, tabela de extensões). Allowlist
 * FECHADA: só o que está aqui entra no schema do ProseMirror. Proibidas as
 * extensões de estilo livre (as que guardam CSS em `style`: estilo de texto,
 * cor livre, família e tamanho de fonte), Image, Code, CodeBlock, HardBreak,
 * Blockquote, HorizontalRule, Table e Mention (spec, §Painel).
 *
 * Módulo sem React para o schema ser testável em `environment: node`
 * (`conversorEditorMensagem.test.ts` valida o JSON contra ele).
 *
 * O editor NÃO é fronteira de confiança: a saída passa pelo conversor e pelo
 * `schemaMensagemModal` no form e de novo na Server Action.
 */

/** Nomes das marks próprias (usados pela barra e pelo conversor). */
export const MARK_TAMANHO = "tamanho";
export const MARK_COR = "cor";
export const MARK_FONTE = "fonte";

const CLASSES_TAMANHO = CLASSES_TAMANHO_MENSAGEM;
const CLASSES_FONTE = CLASSES_FONTE_MENSAGEM;

/**
 * Mark de valor enumerado. `parseHTML: () => []`: NUNCA lê `style`, cor,
 * família ou tamanho de fonte de HTML nenhum. O atributo `valor` só vira
 * classe de mapa constante (consultado com `Object.hasOwn`); fora do enum, a
 * mark não pinta nada e o conversor a descarta.
 */
function markEnumerada(
  nome: string,
  valores: readonly string[],
  classes: Readonly<Record<string, string>>,
) {
  return Mark.create({
    name: nome,
    parseHTML: () => [],
    addAttributes() {
      return {
        valor: {
          default: null,
          parseHTML: () => null,
          renderHTML: (atributos: Record<string, unknown>) => {
            const valor = atributos.valor;
            return typeof valor === "string" &&
              valores.includes(valor) &&
              Object.hasOwn(classes, valor)
              ? { class: classes[valor] }
              : {};
          },
        },
      };
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes), 0];
    },
  });
}

export const MarkTamanho = markEnumerada(MARK_TAMANHO, TAMANHOS_TRECHO, CLASSES_TAMANHO);
export const MarkCor = markEnumerada(MARK_COR, CORES_MENSAGEM, CLASSES_COR_MENSAGEM);
export const MarkFonte = markEnumerada(MARK_FONTE, FONTES_TRECHO, CLASSES_FONTE);

/** Predicado único de link do editor: o mesmo guard do zod (RN-M12). */
function linkAceito(url: string): boolean {
  return urlLinkExternoSegura(url) !== null;
}

/** A lista fechada de extensões. Uma instância nova por editor. */
export function criarExtensoesMensagem(): AnyExtension[] {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Underline,
    Strike,
    UndoRedo,
    // Representação NO EDITOR do `tipo: "titulo"`. Na vitrine é `<p>` (RN-M14).
    Heading.configure({ levels: [2] }),
    BulletList,
    OrderedList,
    // Sem `block*`: um item só tem um parágrafo, lista aninhada é impossível.
    ListItem.extend({ content: "paragraph" }),
    TextAlign.configure({
      types: ["paragraph", "heading"],
      alignments: ["left", "center", "right"],
    }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      isAllowedUri: (url) => linkAceito(url),
      shouldAutoLink: (url) => linkAceito(url),
      HTMLAttributes: {
        rel: "noopener noreferrer",
        target: null,
        class: `${CLASSE_COR_LINK_MENSAGEM} underline underline-offset-2`,
      },
    }),
    MarkTamanho,
    MarkCor,
    MarkFonte,
  ];
}
