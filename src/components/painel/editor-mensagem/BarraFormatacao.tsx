"use client";

import { useId, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Heading,
  Italic,
  Link,
  List,
  ListOrdered,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  Unlink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CORES_MENSAGEM, PALETA_MENSAGEM, type CorMensagem } from "@/lib/constants/paletaMensagem";
import { urlLinkExternoSegura } from "@/lib/utils/urlLinkExternoSegura";
import { FONTES_TRECHO, TAMANHOS_TRECHO } from "@/lib/validacoes/mensagemModal";
import { MARK_COR, MARK_FONTE, MARK_TAMANHO } from "./extensoesEditorMensagem";

/**
 * Barra de formatação do editor da mensagem (spec
 * modal-sazonal-mensagem-formatada, §Painel). Grupos de `ToggleGroup` (shadcn),
 * cada botão com nome acessível e alvo de 44×44 em valor literal
 * (`design-system.md` §5). No celular, os grupos quebram em linhas.
 *
 * Só aplica valores dos enums fechados (tamanho, cor da paleta RN-M13, fonte,
 * alinhamento, tipo de bloco). O link passa por `urlLinkExternoSegura` já no
 * campo, o mesmo guard do zod (RN-M12).
 */

const ALVO = "h-auto min-h-[44px] min-w-[44px]";

const ROTULOS_COR: Readonly<Record<CorMensagem, string>> = Object.freeze({
  marrom: "Marrom",
  vermelho: "Vermelho",
  laranja: "Laranja",
  verde: "Verde",
  azul: "Azul",
  roxo: "Roxo",
  cinza: "Cinza",
});

const ROTULOS_TAMANHO: Readonly<Record<"normal" | (typeof TAMANHOS_TRECHO)[number], string>> =
  Object.freeze({ pequeno: "Pequeno", normal: "Normal", grande: "Grande", enorme: "Enorme" });

const OPCOES_FONTE: readonly { valor: "padrao" | (typeof FONTES_TRECHO)[number]; rotulo: string; classe: string }[] = [
  { valor: "padrao", rotulo: "Padrão", classe: "font-sans" },
  { valor: "serifa", rotulo: "Serifada", classe: "font-serif" },
  { valor: "mono", rotulo: "Monoespaçada", classe: "font-mono" },
];

const MARCAS = [
  { valor: "bold", rotulo: "Negrito", icone: <Bold aria-hidden /> },
  { valor: "italic", rotulo: "Itálico", icone: <Italic aria-hidden /> },
  { valor: "underline", rotulo: "Sublinhado", icone: <Underline aria-hidden /> },
  { valor: "strike", rotulo: "Tachado", icone: <Strikethrough aria-hidden /> },
] as const;

type Marca = (typeof MARCAS)[number]["valor"];
type TipoBloco = "titulo" | "lista" | "numerada";
type Alinhar = "left" | "center" | "right";

const ERRO_LINK = "Use um endereço completo que comece com https://";

/** Mantém a seleção do editor ao clicar num botão da barra. */
function manterSelecao(e: MouseEvent): void {
  e.preventDefault();
}

function valorDaMark(editor: Editor, nome: string): string | null {
  const valor: unknown = editor.getAttributes(nome).valor;
  return typeof valor === "string" ? valor : null;
}

function Grupo({ rotulo, children }: { rotulo: string; children: ReactNode }): ReactElement {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap items-center gap-1">
      {children}
    </div>
  );
}

export function BarraFormatacao({ editor }: { editor: Editor }): ReactElement {
  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      marcas: MARCAS.filter((m) => e.isActive(m.valor)).map((m) => m.valor as Marca),
      tamanho: valorDaMark(e, MARK_TAMANHO) ?? "normal",
      cor: valorDaMark(e, MARK_COR) ?? "automatica",
      fonte: valorDaMark(e, MARK_FONTE) ?? "padrao",
      bloco: (e.isActive("heading")
        ? "titulo"
        : e.isActive("bulletList")
          ? "lista"
          : e.isActive("orderedList")
            ? "numerada"
            : null) as TipoBloco | null,
      alinhamento: (e.isActive({ textAlign: "center" })
        ? "center"
        : e.isActive({ textAlign: "right" })
          ? "right"
          : "left") as Alinhar,
      emLink: e.isActive("link"),
      hrefAtual: e.isActive("link") ? String(e.getAttributes("link").href ?? "") : "",
    }),
  });

  const [linkAberto, setLinkAberto] = useState(false);
  const [url, setUrl] = useState("");
  const idUrl = useId();
  const idErro = useId();
  const urlValida = urlLinkExternoSegura(url.trim());
  const mostrarErro = url.trim() !== "" && urlValida === null;

  function alternarMarcas(novas: Marca[]): void {
    for (const m of MARCAS) {
      const ligada = novas.includes(m.valor);
      if (ligada !== estado.marcas.includes(m.valor)) {
        editor.chain().focus().toggleMark(m.valor).run();
      }
    }
  }

  function aplicarEnum(mark: string, valor: string | undefined, padrao: string, validos: readonly string[]): void {
    const c = editor.chain().focus();
    if (valor === undefined || valor === padrao || !validos.includes(valor)) c.unsetMark(mark).run();
    else c.setMark(mark, { valor }).run();
  }

  function aplicarBloco(tipo: TipoBloco | undefined): void {
    const c = editor.chain().focus();
    if (tipo === "lista") {
      c.setParagraph();
      if (!editor.isActive("bulletList")) c.toggleBulletList();
    } else if (tipo === "numerada") {
      c.setParagraph();
      if (!editor.isActive("orderedList")) c.toggleOrderedList();
    } else {
      if (editor.isActive("bulletList")) c.toggleBulletList();
      else if (editor.isActive("orderedList")) c.toggleOrderedList();
      if (tipo === "titulo") c.setHeading({ level: 2 });
      else c.setParagraph();
    }
    c.run();
  }

  function abrirLink(): void {
    setUrl(estado.hrefAtual);
    setLinkAberto(true);
  }

  function aplicarLink(): void {
    if (urlValida === null) return;
    if (editor.state.selection.empty && !estado.emLink) {
      // Sem trecho selecionado: o próprio endereço vira o texto do link (JSON, nunca HTML).
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: urlValida, marks: [{ type: "link", attrs: { href: urlValida } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: urlValida }).run();
    }
    setLinkAberto(false);
    setUrl("");
  }

  function removerLink(): void {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkAberto(false);
    setUrl("");
  }

  return (
    <div className="flex flex-col gap-2 rounded-t-md border border-b-0 border-input bg-muted/40 p-2">
      <div role="toolbar" aria-label="Formatação da mensagem" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Grupo rotulo="Marcas">
          <ToggleGroup multiple value={estado.marcas} onValueChange={(v) => alternarMarcas(v as Marca[])} spacing={1}>
            {MARCAS.map((m) => (
              <ToggleGroupItem key={m.valor} value={m.valor} aria-label={m.rotulo} title={m.rotulo} className={ALVO} onMouseDown={manterSelecao}>
                {m.icone}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Grupo>

        <Grupo rotulo="Tamanho">
          <ToggleGroup
            value={[estado.tamanho]}
            onValueChange={(v) => aplicarEnum(MARK_TAMANHO, v[0], "normal", TAMANHOS_TRECHO)}
            spacing={1}
          >
            {(["pequeno", "normal", "grande", "enorme"] as const).map((t) => (
              <ToggleGroupItem key={t} value={t} className={`${ALVO} px-2`} onMouseDown={manterSelecao}>
                {ROTULOS_TAMANHO[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Grupo>

        <Grupo rotulo="Cor">
          <ToggleGroup
            value={[estado.cor]}
            onValueChange={(v) => aplicarEnum(MARK_COR, v[0], "automatica", CORES_MENSAGEM)}
            spacing={1}
          >
            <ToggleGroupItem value="automatica" aria-label="Cor automática" title="Cor automática" className={`${ALVO} px-2`} onMouseDown={manterSelecao}>
              Auto
            </ToggleGroupItem>
            {CORES_MENSAGEM.map((cor) => (
              <ToggleGroupItem
                key={cor}
                value={cor}
                aria-label={ROTULOS_COR[cor]}
                title={ROTULOS_COR[cor]}
                className={ALVO}
                onMouseDown={manterSelecao}
              >
                <span
                  aria-hidden
                  className="block size-6 rounded-full border border-black/10"
                  style={{ backgroundColor: PALETA_MENSAGEM[cor] }}
                />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Grupo>

        <Grupo rotulo="Fonte">
          <ToggleGroup
            value={[estado.fonte]}
            onValueChange={(v) => aplicarEnum(MARK_FONTE, v[0], "padrao", FONTES_TRECHO)}
            spacing={1}
          >
            {OPCOES_FONTE.map((f) => (
              <ToggleGroupItem key={f.valor} value={f.valor} className={`${ALVO} px-2 ${f.classe}`} onMouseDown={manterSelecao}>
                {f.rotulo}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Grupo>

        <Grupo rotulo="Parágrafo">
          <ToggleGroup
            value={estado.bloco === null ? [] : [estado.bloco]}
            onValueChange={(v) => aplicarBloco(v[0] as TipoBloco | undefined)}
            spacing={1}
          >
            <ToggleGroupItem value="titulo" aria-label="Título" title="Título" className={ALVO} onMouseDown={manterSelecao}>
              <Heading aria-hidden />
            </ToggleGroupItem>
            <ToggleGroupItem value="lista" aria-label="Lista" title="Lista" className={ALVO} onMouseDown={manterSelecao}>
              <List aria-hidden />
            </ToggleGroupItem>
            <ToggleGroupItem value="numerada" aria-label="Lista numerada" title="Lista numerada" className={ALVO} onMouseDown={manterSelecao}>
              <ListOrdered aria-hidden />
            </ToggleGroupItem>
          </ToggleGroup>
        </Grupo>

        <Grupo rotulo="Alinhamento">
          <ToggleGroup
            value={[estado.alinhamento]}
            onValueChange={(v) => {
              const a = (v[0] ?? "left") as Alinhar;
              editor.chain().focus().setTextAlign(a).run();
            }}
            spacing={1}
          >
            <ToggleGroupItem value="left" aria-label="Esquerda" title="Esquerda" className={ALVO} onMouseDown={manterSelecao}>
              <TextAlignStart aria-hidden />
            </ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Centro" title="Centro" className={ALVO} onMouseDown={manterSelecao}>
              <TextAlignCenter aria-hidden />
            </ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Direita" title="Direita" className={ALVO} onMouseDown={manterSelecao}>
              <TextAlignEnd aria-hidden />
            </ToggleGroupItem>
          </ToggleGroup>
        </Grupo>

        <Grupo rotulo="Link">
          <Button
            type="button"
            variant="ghost"
            className={ALVO}
            aria-expanded={linkAberto}
            onMouseDown={manterSelecao}
            onClick={abrirLink}
          >
            <Link aria-hidden className="size-4" />
            Inserir link
          </Button>
          {estado.emLink ? (
            <Button type="button" variant="ghost" className={ALVO} onMouseDown={manterSelecao} onClick={removerLink}>
              <Unlink aria-hidden className="size-4" />
              Remover link
            </Button>
          ) : null}
        </Grupo>
      </div>

      {linkAberto ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={idUrl} className="text-xs font-medium text-foreground">
            Endereço do link
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={idUrl}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  aplicarLink();
                }
                if (e.key === "Escape") setLinkAberto(false);
              }}
              aria-invalid={mostrarErro}
              aria-describedby={mostrarErro ? idErro : undefined}
              className="min-h-[44px] flex-1"
            />
            <Button type="button" className="min-h-[44px]" disabled={urlValida === null} onClick={aplicarLink}>
              Aplicar
            </Button>
            <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setLinkAberto(false)}>
              Cancelar
            </Button>
          </div>
          {mostrarErro ? (
            <p id={idErro} className="text-xs text-destructive">
              {ERRO_LINK}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
