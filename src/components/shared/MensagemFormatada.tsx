import { ExternalLink } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { CLASSE_COR_LINK_MENSAGEM, CLASSES_COR_MENSAGEM } from "@/lib/constants/paletaMensagem";
import { urlLinkExternoSegura } from "@/lib/utils/urlLinkExternoSegura";
import type {
  LinkExternoValidado,
  MensagemModalValidada,
} from "@/lib/validacoes/mensagemModal";

/**
 * Renderizador da mensagem do modal sazonal (spec modal-sazonal-mensagem-formatada,
 * RN-M05, RN-M06, RN-M12, RN-M14). Seguro POR CONSTRUÇÃO, mesmo recebendo lixo
 * (o tipo branded é a primeira barreira; este componente é a última):
 *  - o texto do lojista só entra como filho de texto do React (escapado);
 *  - todo atributo é lido com `Object.hasOwn` e toda classe vem de mapa
 *    constante consultado com `Object.hasOwn` (`MAPA["constructor"]` devolveria
 *    uma função); marca booleana só com `=== true`;
 *  - nenhum `<a>`, `href`, `style`, `id`, `data-*`, portal ou heading: o link é
 *    `<button>` que só avisa o pai, e o único `href` do fluxo é o do
 *    `AvisoSaidaLink`. Título da mensagem é `<p>`: o `DialogTitle` é o heading;
 *  - sem recursão: listas são itens consecutivos agrupados num laço;
 *  - contêiner com quebra de palavra forçada e sem posicionamento.
 *
 * Sem `'use client'` próprio: vive dentro do `ModalSazonal` (cliente) e da
 * prévia do painel. Sem `aoEscolherLink` (prévia), o link vira `<span>`.
 */

const CLASSES_TAMANHO: Readonly<Record<string, string>> = Object.freeze({
  pequeno: "text-sm",
  grande: "text-lg",
  enorme: "text-xl",
});

const CLASSES_FONTE: Readonly<Record<string, string>> = Object.freeze({
  serifa: "font-serif",
  mono: "font-mono",
});

const CLASSES_ALINHAMENTO: Readonly<Record<string, string>> = Object.freeze({
  centro: "text-center",
  direita: "text-right",
});

const CLASSE_CONTEINER = "flex flex-col gap-2 break-words [overflow-wrap:anywhere]";
const CLASSE_TITULO = "text-lg font-bold";
const CLASSE_LISTA_MARCADOR = "list-disc pl-5";
const CLASSE_LISTA_NUMERADA = "list-decimal pl-5";
/** Visual FIXO do link: não depende do texto nem de cor/sublinhado do lojista. */
const CLASSE_LINK = `inline cursor-pointer ${CLASSE_COR_LINK_MENSAGEM} underline underline-offset-2`;
const CLASSE_ICONE_LINK = "ml-0.5 inline size-[0.9em] align-[-0.1em]";

/** Lê uma chave PRÓPRIA de um objeto qualquer (nunca do protótipo). */
function campo(obj: unknown, chave: string): unknown {
  return typeof obj === "object" && obj !== null && Object.hasOwn(obj, chave)
    ? (obj as Record<string, unknown>)[chave]
    : undefined;
}

function classeDoMapa(mapa: Readonly<Record<string, string>>, valor: unknown): string | null {
  return typeof valor === "string" && Object.hasOwn(mapa, valor) ? mapa[valor] : null;
}

function listaDe(valor: unknown): readonly unknown[] {
  return Array.isArray(valor) ? valor : [];
}

type Props = {
  mensagem: MensagemModalValidada;
  aoEscolherLink?: (link: LinkExternoValidado) => void;
};

function renderizarTrecho(
  trecho: unknown,
  indice: number,
  aoEscolherLink: Props["aoEscolherLink"],
): ReactNode {
  const texto = campo(trecho, "texto");
  if (typeof texto !== "string" || texto === "") return null;

  // Link revalidado aqui também: valor forçado inválido vira texto comum.
  const link = urlLinkExternoSegura(campo(trecho, "link"));

  let no: ReactNode = texto;
  if (campo(trecho, "negrito") === true) no = <strong>{no}</strong>;
  if (campo(trecho, "italico") === true) no = <em>{no}</em>;
  if (campo(trecho, "tachado") === true) no = <s>{no}</s>;

  const classes: string[] = [];
  // Link tem cor e sublinhado fixos: os do lojista não se aplicam.
  if (link === null && campo(trecho, "sublinhado") === true) classes.push("underline");
  const tamanho = classeDoMapa(CLASSES_TAMANHO, campo(trecho, "tamanho"));
  if (tamanho !== null) classes.push(tamanho);
  if (link === null) {
    const cor = classeDoMapa(CLASSES_COR_MENSAGEM, campo(trecho, "cor"));
    if (cor !== null) classes.push(cor);
  }
  const fonte = classeDoMapa(CLASSES_FONTE, campo(trecho, "fonte"));
  if (fonte !== null) classes.push(fonte);
  if (classes.length > 0) no = <span className={classes.join(" ")}>{no}</span>;

  if (link === null) return <Fragment key={indice}>{no}</Fragment>;

  const conteudoLink = (
    <>
      {no}
      <span className="sr-only"> (link externo, abre aviso)</span>
      <ExternalLink aria-hidden="true" className={CLASSE_ICONE_LINK} />
    </>
  );
  if (aoEscolherLink === undefined) {
    return (
      <span key={indice} className={CLASSE_LINK}>
        {conteudoLink}
      </span>
    );
  }
  return (
    <button key={indice} type="button" className={CLASSE_LINK} onClick={() => aoEscolherLink(link)}>
      {conteudoLink}
    </button>
  );
}

function renderizarConteudo(paragrafo: unknown, aoEscolherLink: Props["aoEscolherLink"]): ReactNode {
  const trechos = listaDe(campo(paragrafo, "trechos"));
  const nos = trechos.map((t, i) => renderizarTrecho(t, i, aoEscolherLink));
  // Parágrafo vazio é linha em branco: o <br> dá a altura de uma linha.
  return nos.some((n) => n !== null) ? nos : <br />;
}

function classeDoBloco(paragrafo: unknown, titulo: boolean): string | undefined {
  const classes: string[] = [];
  if (titulo) classes.push(CLASSE_TITULO);
  const alinhamento = classeDoMapa(CLASSES_ALINHAMENTO, campo(paragrafo, "alinhamento"));
  if (alinhamento !== null) classes.push(alinhamento);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

type TipoLista = "item-lista" | "item-numerado";

function tipoDeLista(paragrafo: unknown): TipoLista | null {
  const tipo = campo(paragrafo, "tipo");
  return tipo === "item-lista" || tipo === "item-numerado" ? tipo : null;
}

export function MensagemFormatada({ mensagem, aoEscolherLink }: Props) {
  const paragrafos = listaDe(campo(mensagem, "paragrafos"));
  const blocos: ReactNode[] = [];

  let i = 0;
  while (i < paragrafos.length) {
    const paragrafo = paragrafos[i];
    const lista = tipoDeLista(paragrafo);
    if (lista === null) {
      blocos.push(
        <p key={i} className={classeDoBloco(paragrafo, campo(paragrafo, "tipo") === "titulo")}>
          {renderizarConteudo(paragrafo, aoEscolherLink)}
        </p>,
      );
      i++;
      continue;
    }
    // Itens consecutivos do mesmo tipo formam UMA lista (sem start/type/value).
    const inicio = i;
    const itens: ReactNode[] = [];
    while (i < paragrafos.length && tipoDeLista(paragrafos[i]) === lista) {
      itens.push(
        <li key={i} className={classeDoBloco(paragrafos[i], false)}>
          {renderizarConteudo(paragrafos[i], aoEscolherLink)}
        </li>,
      );
      i++;
    }
    blocos.push(
      lista === "item-lista" ? (
        <ul key={inicio} className={CLASSE_LISTA_MARCADOR}>
          {itens}
        </ul>
      ) : (
        <ol key={inicio} className={CLASSE_LISTA_NUMERADA}>
          {itens}
        </ol>
      ),
    );
  }

  return <div className={CLASSE_CONTEINER}>{blocos}</div>;
}
