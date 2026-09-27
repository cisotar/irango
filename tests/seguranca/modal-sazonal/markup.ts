/**
 * Helpers de inspeção de markup para as suítes de vetor do modal sazonal
 * (V1, V2, V3, V7). Sem jsdom e sem parser HTML no projeto: o markup vem de
 * `renderToStaticMarkup`, que ESCAPA `<`, `>` e `&` do texto. Por isso todo
 * `<...>` que sobra no markup é uma TAG real, nunca texto do lojista — e é só
 * dentro das tags que procuramos atributo perigoso (`on*=`, `href`, `style=`).
 * Procurar `onerror=` no markup inteiro daria falso positivo com o texto
 * escapado `&lt;img src=x onerror=alert(1)&gt;`, que é inerte.
 */

const RE_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*?)?)(\/?)>/g;

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "source", "track", "wbr",
]);

/** Todas as tags de abertura (texto bruto de cada `<...>`). */
export function tagsDeAbertura(markup: string): string[] {
  return [...markup.matchAll(RE_TAG)]
    .filter((m) => m[1] === "")
    .map((m) => m[0]);
}

/** Atributo perigoso em alguma TAG real (nunca no texto escapado). */
export function atributosPerigososEmTags(markup: string): string[] {
  const achados: string[] = [];
  for (const tag of tagsDeAbertura(markup)) {
    if (/\son[a-z]+\s*=/i.test(tag)) achados.push(`on*= em ${tag}`);
    if (/\shref\s*=/i.test(tag)) achados.push(`href em ${tag}`);
    if (/\sstyle\s*=/i.test(tag)) achados.push(`style em ${tag}`);
    if (/\ssrc\s*=/i.test(tag)) achados.push(`src em ${tag}`);
  }
  return achados;
}

/** Tokens de classe de todas as tags. */
export function tokensDeClasse(markup: string): string[] {
  const tokens: string[] = [];
  for (const tag of tagsDeAbertura(markup)) {
    const m = /\sclass="([^"]*)"/.exec(tag);
    if (m) tokens.push(...m[1].split(/\s+/).filter(Boolean));
  }
  return tokens;
}

export type TagAberta = { nome: string; atributos: string; inicio: number };

/**
 * Pilha de elementos abertos imediatamente ANTES de `posicao` (ancestrais do
 * texto/tag que começa ali). A tag que começa exatamente em `posicao` não entra.
 */
export function ancestraisEm(markup: string, posicao: number): TagAberta[] {
  const pilha: TagAberta[] = [];
  for (const m of markup.matchAll(RE_TAG)) {
    const inicio = m.index ?? 0;
    if (inicio >= posicao) break;
    const [, fecha, nomeBruto, atributos, autoFecha] = m;
    const nome = nomeBruto.toLowerCase();
    if (fecha) {
      // fecha até a última ocorrência do mesmo nome
      for (let i = pilha.length - 1; i >= 0; i--) {
        if (pilha[i].nome === nome) {
          pilha.length = i;
          break;
        }
      }
      continue;
    }
    if (autoFecha || VOID.has(nome)) continue;
    pilha.push({ nome, atributos, inicio });
  }
  return pilha;
}

export function classeDe(tag: TagAberta): string {
  return /\sclass="([^"]*)"/.exec(tag.atributos)?.[1] ?? "";
}
