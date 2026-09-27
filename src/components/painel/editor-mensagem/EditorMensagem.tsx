"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import type { MensagemModalValidada } from "@/lib/validacoes/mensagemModal";
import { BarraFormatacao } from "./BarraFormatacao";
import {
  documentoEditorParaMensagem,
  mensagemParaDocumentoEditor,
  type MensagemDoEditor,
} from "./conversorEditorMensagem";
import { criarExtensoesMensagem } from "./extensoesEditorMensagem";

/**
 * Editor da mensagem do modal sazonal (spec modal-sazonal-mensagem-formatada,
 * §Painel). Carregado SÓ pelo `FormModalSazonal`, via `next/dynamic` com
 * `ssr: false`: o Tiptap não entra no bundle de nenhuma outra rota, e o lint
 * (`no-restricted-imports`) proíbe `@tiptap/*` fora desta pasta.
 *
 * - conteúdo inicial só em JSON (`mensagemParaDocumentoEditor`), nunca HTML;
 * - colar entra como TEXTO PURO (cada linha vira um parágrafo): nada de
 *   formatação, link ou imagem de outro app; arrastar de fora é ignorado;
 * - a cada mudança o pai recebe o formato iRango BRUTO, que ele valida com o
 *   `schemaMensagemModal`. O editor não é fronteira de confiança.
 */

const CLASSE_AREA =
  "min-h-32 w-full rounded-b-md border border-input bg-background px-3 py-2 text-sm text-foreground " +
  "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
  "break-words [overflow-wrap:anywhere] [&_p]:my-1 [&_h2]:my-1 [&_h2]:text-lg [&_h2]:font-bold " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5";

/** Insere só `text/plain`, uma linha por parágrafo. */
function colarTextoPuro(view: EditorView, event: ClipboardEvent): boolean {
  event.preventDefault();
  const texto = event.clipboardData?.getData("text/plain") ?? "";
  if (texto === "") return true;
  const { schema } = view.state;
  const paragrafos = texto
    .split(/\r\n?|\n/)
    .map((linha) => schema.nodes.paragraph.create(null, linha === "" ? null : schema.text(linha)));
  const slice = new Slice(Fragment.from(paragrafos), 1, 1);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}

export function EditorMensagem({
  inicial,
  aoMudar,
  idRotulo,
  idAjuda,
}: {
  /** Mensagem salva (já parseada por `lerMensagemModal` no SSR) ou `null`. */
  inicial: MensagemModalValidada | null;
  aoMudar: (mensagem: MensagemDoEditor) => void;
  /** `id` do rótulo visível do campo (nome acessível da área editável). */
  idRotulo: string;
  /** `id` do texto de ajuda/contador (descrição acessível). */
  idAjuda?: string;
}): ReactElement {
  // Callback do pai num ref: o editor é criado uma vez só.
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  }, [aoMudar]);

  const [extensoes] = useState(criarExtensoesMensagem);
  const [conteudoInicial] = useState(() => mensagemParaDocumentoEditor(inicial));

  const editor = useEditor({
    extensions: extensoes,
    content: conteudoInicial,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: CLASSE_AREA,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": idRotulo,
        ...(idAjuda !== undefined ? { "aria-describedby": idAjuda } : {}),
      },
      handlePaste: (view, event) => colarTextoPuro(view, event),
      // Mover texto DENTRO do editor segue valendo; o que vem de fora, não.
      handleDrop: (_view, _event, _slice, movido) => !movido,
    },
    onUpdate: ({ editor: e }) => {
      aoMudarRef.current(documentoEditorParaMensagem(e.getJSON()));
    },
  });

  if (editor === null) {
    return <div className={`${CLASSE_AREA} rounded-md`} aria-busy="true" />;
  }

  return (
    <div className="flex flex-col">
      <BarraFormatacao editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
