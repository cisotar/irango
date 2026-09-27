import { z } from "zod";

import { CORES_MENSAGEM, type CorMensagem } from "@/lib/constants/paletaMensagem";
import { removerInvisiveisEControles } from "@/lib/utils/normalizarObservacao";
import {
  TETO_URL_BRUTA,
  urlLinkExternoSegura,
  type LinkExternoValidado,
} from "@/lib/utils/urlLinkExternoSegura";

/**
 * Mensagem formatada do modal sazonal (spec modal-sazonal-mensagem-formatada,
 * §Formato da mensagem, RN-M03, RN-M04, RN-M08, RN-M12, RN-M13, RN-M14).
 *
 * Um zod, três autoridades: o form do painel (UX), a Server Action (escrita) e o
 * SSR da vitrine/painel (leitura, via `lerMensagemModal`). A mensagem NÃO é
 * HTML: é um documento plano de parágrafos e trechos, cada atributo um enum
 * fechado ou `true`, e o link a única string além do texto.
 *
 * Ordem do parse (inegociável, CWE-770):
 *   1. schema BRUTO, sem nenhum transform: `.strict()` em todos os níveis, chave
 *      própria `__proto__` recusada antes do strict (o zod v4 a aceitaria),
 *      enums, e os tetos brutos (40 parágrafos, 200 trechos por parágrafo, 3200
 *      por texto, 2048 por URL). Um payload gigante reprova AQUI, sem que um
 *      único trecho seja transformado;
 *   2. canonização (um transform só, no documento inteiro);
 *   3. tetos canônicos (20 parágrafos, 120 trechos, 10 links, 800 caracteres).
 * Sem schema recursivo (nada de lazy) e sem recursão: estrutura plana por construção.
 */

export { TETO_URL_BRUTA, TETO_URL_CANONICA } from "@/lib/utils/urlLinkExternoSegura";
export type { LinkExternoValidado } from "@/lib/utils/urlLinkExternoSegura";

// ── Tetos (RN-M08) ─────────────────────────────────────────────────────────

/** Caracteres visíveis no documento canônico (UTF-16; URL de link não conta). */
export const TETO_CARACTERES_MENSAGEM = 800;
/** Parágrafos no documento canônico (inclui linha em branco, título e item). */
export const TETO_PARAGRAFOS = 20;
/** Parágrafos no documento bruto, antes de colapsar vazios. */
export const TETO_PARAGRAFOS_BRUTO = 40;
/** Trechos por parágrafo no bruto, antes da fusão. */
export const TETO_TRECHOS_POR_PARAGRAFO_BRUTO = 200;
/** Trechos no documento canônico, depois da fusão. */
export const TETO_TRECHOS = 120;
/** Texto bruto por trecho, antes da normalização. */
export const TETO_TEXTO_TRECHO_BRUTO = 3200;
/** Trechos com link no documento canônico. */
export const TETO_LINKS = 10;

// ── Enums (canônicos: o valor-padrão é AUSENTE) ────────────────────────────

export const TAMANHOS_TRECHO = ["pequeno", "grande", "enorme"] as const;
export const FONTES_TRECHO = ["serifa", "mono"] as const;
export const TIPOS_PARAGRAFO = ["titulo", "item-lista", "item-numerado"] as const;
export const ALINHAMENTOS_PARAGRAFO = ["centro", "direita"] as const;

export type TamanhoTrecho = (typeof TAMANHOS_TRECHO)[number];
export type FonteTrecho = (typeof FONTES_TRECHO)[number];
export type TipoParagrafo = (typeof TIPOS_PARAGRAFO)[number];
export type Alinhamento = (typeof ALINHAMENTOS_PARAGRAFO)[number];
export type CorTrecho = CorMensagem;

// ── Forma canônica ─────────────────────────────────────────────────────────

export type Trecho = {
  texto: string;
  negrito?: true;
  italico?: true;
  sublinhado?: true;
  tachado?: true;
  tamanho?: TamanhoTrecho;
  cor?: CorTrecho;
  fonte?: FonteTrecho;
  link?: LinkExternoValidado;
};

export type Paragrafo = {
  tipo?: TipoParagrafo;
  alinhamento?: Alinhamento;
  trechos: Trecho[];
};

export type MensagemModal = { versao: 1; paragrafos: Paragrafo[] };

/** Documento que atravessou `schemaMensagemModal`. Só nasce do parse. */
export type MensagemModalValidada = MensagemModal & z.BRAND<"MensagemModalValidada">;

// ── Schema bruto (sem transform) ───────────────────────────────────────────

/**
 * O zod v4 aceita a chave PRÓPRIA `__proto__` (vinda de `JSON.parse`) num
 * `strictObject`. Esta barreira roda antes do strict em todos os níveis.
 */
const CHAVES_PROIBIDAS = ["__proto__", "constructor", "prototype"] as const;
const semChaveDePrototipo = z.custom<unknown>(
  (v) =>
    typeof v !== "object" ||
    v === null ||
    !CHAVES_PROIBIDAS.some((chave) => Object.hasOwn(v, chave)),
  { message: "Chave não permitida" },
);

const marcaBruta = z.boolean().optional();

const trechoBruto = semChaveDePrototipo.pipe(
  z.strictObject({
    texto: z.string().max(TETO_TEXTO_TRECHO_BRUTO),
    negrito: marcaBruta,
    italico: marcaBruta,
    sublinhado: marcaBruta,
    tachado: marcaBruta,
    tamanho: z.enum(["normal", ...TAMANHOS_TRECHO]).optional(),
    cor: z.enum(["automatica", ...CORES_MENSAGEM]).optional(),
    fonte: z.enum(["padrao", ...FONTES_TRECHO]).optional(),
    link: z.string().max(TETO_URL_BRUTA).optional(),
  }),
);

const paragrafoBruto = semChaveDePrototipo.pipe(
  z.strictObject({
    tipo: z.enum(["paragrafo", ...TIPOS_PARAGRAFO]).optional(),
    alinhamento: z.enum(["esquerda", ...ALINHAMENTOS_PARAGRAFO]).optional(),
    trechos: z.array(trechoBruto).max(TETO_TRECHOS_POR_PARAGRAFO_BRUTO),
  }),
);

const documentoBruto = semChaveDePrototipo.pipe(
  z.strictObject({
    versao: z.literal(1),
    paragrafos: z.array(paragrafoBruto).max(TETO_PARAGRAFOS_BRUTO),
  }),
);

type DocumentoBruto = z.output<typeof documentoBruto>;
type TrechoBruto = DocumentoBruto["paragrafos"][number]["trechos"][number];

// ── Canonização (RN-M03) ───────────────────────────────────────────────────

/**
 * Quebra de linha e tab viram ESPAÇO antes de `removerInvisiveisEControles`,
 * que preserva `\t`/`\n` e APAGA U+2028/2029. Parágrafo é a única quebra.
 */
const RE_QUEBRA_OU_TAB = /[\t\n\v\f\r\u0085\u2028\u2029]/g;

const ATRIBUTOS_DE_FUSAO = [
  "negrito",
  "italico",
  "sublinhado",
  "tachado",
  "tamanho",
  "cor",
  "fonte",
  "link",
] as const satisfies readonly (keyof Trecho)[];

function mesmosAtributos(a: Trecho, b: Trecho): boolean {
  return ATRIBUTOS_DE_FUSAO.every((k) => a[k] === b[k]);
}

function temTextoVisivel(trechos: readonly { texto: string }[]): boolean {
  return trechos.some((t) => /\S/.test(t.texto));
}

/** Monta o trecho canônico (chaves só quando ligadas). `null` = link inválido. */
function canonizarTrecho(t: TrechoBruto, emTitulo: boolean): Trecho | null {
  const texto = removerInvisiveisEControles(t.texto.replace(RE_QUEBRA_OU_TAB, " "), {
    preservarJuncaoDeEmoji: true,
  });
  let link: LinkExternoValidado | undefined;
  if (t.link !== undefined) {
    const validado = urlLinkExternoSegura(t.link);
    if (validado === null) return null;
    link = validado;
  }
  const trecho: Trecho = { texto };
  if (t.negrito === true) trecho.negrito = true;
  if (t.italico === true) trecho.italico = true;
  // 2. link tem visual fixo: `sublinhado` e `cor` do lojista saem.
  if (t.sublinhado === true && link === undefined) trecho.sublinhado = true;
  if (t.tachado === true) trecho.tachado = true;
  // 3. título tem tamanho fixo.
  if (t.tamanho !== undefined && t.tamanho !== "normal" && !emTitulo) trecho.tamanho = t.tamanho;
  if (t.cor !== undefined && t.cor !== "automatica" && link === undefined) trecho.cor = t.cor;
  if (t.fonte !== undefined && t.fonte !== "padrao") trecho.fonte = t.fonte;
  if (link !== undefined) trecho.link = link;
  return trecho;
}

type ResultadoCanonizacao = { ok: true; valor: MensagemModal | null } | { ok: false; motivo: string };

function canonizar(bruto: DocumentoBruto): ResultadoCanonizacao {
  const paragrafos: Paragrafo[] = [];
  for (const p of bruto.paragrafos) {
    const tipo = p.tipo === "paragrafo" ? undefined : p.tipo;
    const alinhamento = p.alinhamento === "esquerda" ? undefined : p.alinhamento;
    const trechos: Trecho[] = [];
    for (const t of p.trechos) {
      const trecho = canonizarTrecho(t, tipo === "titulo");
      if (trecho === null) return { ok: false, motivo: "Link inválido" };
      // 1. trecho de texto vazio some.
      if (trecho.texto === "") continue;
      // 4. funde com o anterior quando todos os atributos são idênticos.
      const anterior = trechos[trechos.length - 1];
      if (anterior !== undefined && mesmosAtributos(anterior, trecho)) {
        anterior.texto += trecho.texto;
      } else {
        trechos.push(trecho);
      }
    }
    // 5. sem texto visível vira parágrafo comum vazio (linha em branco).
    if (!temTextoVisivel(trechos)) {
      paragrafos.push({ trechos: [] });
      continue;
    }
    const paragrafo: Paragrafo = { trechos };
    if (tipo !== undefined) paragrafo.tipo = tipo;
    if (alinhamento !== undefined) paragrafo.alinhamento = alinhamento;
    paragrafos.push(paragrafo);
  }

  // 6. sem vazio no começo nem no fim; 2+ vazios seguidos viram 1.
  const compactados: Paragrafo[] = [];
  for (const p of paragrafos) {
    const vazio = p.trechos.length === 0;
    if (vazio && (compactados.length === 0 || compactados[compactados.length - 1].trechos.length === 0)) {
      continue;
    }
    compactados.push(p);
  }
  while (compactados.length > 0 && compactados[compactados.length - 1].trechos.length === 0) {
    compactados.pop();
  }

  // 7. nada visível: sem mensagem.
  if (compactados.length === 0) return { ok: true, valor: null };
  return { ok: true, valor: { versao: 1, paragrafos: compactados } };
}

/**
 * Caracteres visíveis da mensagem (unidades UTF-16 do texto; a URL do link não
 * conta). A MESMA função do contador da UI e do teto do zod.
 */
export function contarCaracteresMensagem(
  mensagem: { paragrafos: readonly { trechos: readonly { texto: string }[] }[] } | null,
): number {
  if (mensagem === null) return 0;
  let total = 0;
  for (const p of mensagem.paragrafos) for (const t of p.trechos) total += t.texto.length;
  return total;
}

function motivoDeTetoCanonico(m: MensagemModal): string | null {
  if (m.paragrafos.length > TETO_PARAGRAFOS) return "Parágrafos demais";
  let trechos = 0;
  let links = 0;
  for (const p of m.paragrafos) {
    trechos += p.trechos.length;
    for (const t of p.trechos) if (t.link !== undefined) links++;
  }
  if (trechos > TETO_TRECHOS) return "Trechos demais";
  if (links > TETO_LINKS) return "Links demais";
  if (contarCaracteresMensagem(m) > TETO_CARACTERES_MENSAGEM) {
    return `A mensagem passa de ${TETO_CARACTERES_MENSAGEM} caracteres`;
  }
  return null;
}

/**
 * Schema da mensagem. Saída: documento canônico com brand, ou `null` quando o
 * documento não tem nenhum caractere visível.
 */
export const schemaMensagemModal = documentoBruto.transform(
  (bruto, ctx): MensagemModalValidada | null => {
    const r = canonizar(bruto);
    if (!r.ok) {
      ctx.issues.push({ code: "custom", message: r.motivo, input: bruto });
      return z.NEVER;
    }
    if (r.valor === null) return null;
    const motivo = motivoDeTetoCanonico(r.valor);
    if (motivo !== null) {
      ctx.issues.push({ code: "custom", message: motivo, input: bruto });
      return z.NEVER;
    }
    return r.valor as MensagemModalValidada;
  },
);

/**
 * Parse na LEITURA, fail-closed (RN-M04). A RLS deixa o dono gravar a própria
 * linha direto no PostgREST, então o que vem do banco é tão hostil quanto um
 * payload. Inválido vira `null` (o modal abre sem a mensagem) e o log leva só
 * os ids, nunca conteúdo nem URL.
 */
export function lerMensagemModal(
  raw: unknown,
  ctx: { lojaId: string; modalId: string },
): MensagemModalValidada | null {
  if (raw === null || raw === undefined) return null;
  let r: ReturnType<typeof schemaMensagemModal.safeParse> | null = null;
  try {
    r = schemaMensagemModal.safeParse(raw);
  } catch {
    r = null;
  }
  if (r === null || !r.success) {
    console.error("[modalSazonal] mensagem inválida", {
      lojaId: ctx.lojaId,
      modalId: ctx.modalId,
    });
    return null;
  }
  return r.data;
}
