import { LIMITE_OBSERVACAO } from "@/lib/constants/pedido";

// Normalização canônica do texto livre de observação de pedido.
//
// Por que existe (plan/167 §Decisão 2): o `trim` do Postgres é `btrim()`, que
// remove SÓ espaço ASCII (U+0020). `\n`, `\r`, `\t` e NBSP (U+00A0) atravessam
// o `nullif(trim(...), '')` da RPC intactos e CONTAM PARA O TETO de 200. O TS é
// a autoridade de normalização; o SQL é defesa em profundidade.
//
// INVARIANTE DE SEGURANÇA: cada passo só ENCURTA ou MANTÉM o comprimento —
// nunca expande. É isso que garante que o `maxLength={200}` do cliente
// (issue 169) jamais produza um payload que o servidor rejeite por tamanho.
//
// Função pura: sem zod, sem `server-only` — pode ser reusada no cliente.
export function normalizarObservacao(texto: string): string {
  // 1. CRLF/CR → LF: uma só representação de quebra de linha (a comanda imprime LF).
  const semCR = texto.replace(/\r\n?/g, "\n");
  const semInvisiveis = removerControlesEInvisiveisBidi(semCR, false);
  const espacado = semInvisiveis
    // 4. TODO espaço horizontal (tab, NBSP, U+2000-200A, U+202F, U+205F,
    //    U+3000) → espaço ASCII. Length-preserving. Sem este passo um NBSP
    //    ISOLADO sobrevivia (o colapso do passo 5 só pega runs de 2+): o tab
    //    quebrava o alinhamento da comanda e, pior, `sem\u00A0cebola` e
    //    `sem cebola` eram textos DIFERENTES — logo duas linhas distintas no
    //    carrinho (issue 168) e dois itens visualmente idênticos na comanda.
    .replace(/[^\S\n]/g, " ")
    // 5. Colapsa espaço horizontal repetido — anti-padding.
    .replace(/[^\S\n]{2,}/g, " ")
    // 6. No máximo uma linha em branco entre parágrafos.
    .replace(/\n{3,}/g, "\n\n")
    // 7. Bordas: o trim() do JS remove \n, \r, \t e NBSP (o btrim do Postgres NÃO).
    .trim();
  return removerSubstitutosDesemparelhados(espacado);
}

// Passos 2 e 3 da normalização (compartilhados com `removerInvisiveisEControles`).
function removerControlesEInvisiveisBidi(texto: string, preservarJuncaoDeEmoji: boolean): string {
  const semControles = texto
    // 2. Controles C0/C1 e DEL, PRESERVANDO \n (U+000A) e \t (U+0009).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  // 3. Invisíveis/bidi: zero-width, separadores de linha/parágrafo, BOM e
  //    TODA a família de controle bidirecional — overrides (U+202A-202E),
  //    isolates (U+2066-U+2069, o par do Trojan Source, CVE-2021-42574),
  //    format chars depreciados (U+206A-206F) e o ALM (U+061C). Sem eles a
  //    comanda impressa pode ser reordenada visualmente: o lojista lê algo
  //    diferente do que está gravado.
  const semBidi = !preservarJuncaoDeEmoji
    ? semControles.replace(/[\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    : // Mesma lista SEM o U+200D (ZWJ), que é tratado depois: sobrevive só quando
      // junta dois pictogramas (família: U+1F468 ZWJ U+1F469 ZWJ U+1F467). Um ZWJ solto entre letras segue removido.
      // O pictograma da esquerda pode vir seguido do seletor U+FE0F ou de um
      // modificador de tom de pele (U+1F3FB-1F3FF), que fazem parte da sequência.
      semControles
        .replace(/[\u061C\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
        .replace(
          /(?<!\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)\u200D|\u200D(?!\p{Extended_Pictographic})/gu,
          "",
        );
  return removerInvisiveisNaoBidi(semBidi, preservarJuncaoDeEmoji);
}

// 3b. Invisíveis que NÃO reordenam texto mas deixam o campo visualmente vazio
//     ou escondem payload (issue 316): SOFT HYPHEN, CGJ, fillers Hangul
//     (U+115F, U+1160, U+3164, U+FFA0), U+180E, Braille em branco (U+2800),
//     âncoras de anotação (U+FFF9-FFFB), seletores de variação U+FE00-FE0D e o
//     bloco de TAGS (U+E0000-E007F, que carrega ASCII invisível). Só encurta.
//     U+FE0F fica fora da lista (apresentação emoji, sempre preservado).
const RE_INVISIVEIS_NAO_BIDI =
  /[\u00AD\u034F\u115F\u1160\u180E\u2800\u3164\uFE00-\uFE0D\uFFA0\uFFF9-\uFFFB]/g;
// U+FE0E (apresentação TEXTO) só vale colado a um pictograma: "coração texto".
const RE_VS15_SOLTO = /(?<!\p{Extended_Pictographic})\uFE0E/gu;
// Tags. Com `preservarJuncaoDeEmoji` sobrevive SÓ a bandeira de subdivisão
// (U+1F3F4 + 2 a 7 tags [0-9a-z] + CANCEL TAG U+E007F): capturada no 1º grupo e
// devolvida intacta. Qualquer outra tag sai; a base da bandeira fica.
const RE_TAGS = /[\u{E0000}-\u{E007F}]/gu;
const RE_BANDEIRA_OU_TAG =
  /(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{2,7}\u{E007F})|[\u{E0000}-\u{E007F}]/gu;

function removerInvisiveisNaoBidi(texto: string, preservarJuncaoDeEmoji: boolean): string {
  const semTags = preservarJuncaoDeEmoji
    ? texto.replace(RE_BANDEIRA_OU_TAG, (_, bandeira?: string) => bandeira ?? "")
    : texto.replace(RE_TAGS, "");
  return semTags.replace(RE_INVISIVEIS_NAO_BIDI, "").replace(RE_VS15_SOLTO, "");
}

// 8. Substituto DESEMPARELHADO: `p_itens` é jsonb e o Postgres RECUSA
//    UTF-8 malformado (`invalid input syntax for type json`), derrubando o
//    pedido inteiro. Um navegador não produz isso pelo textarea, mas uma
//    chamada forjada da Server Action produz. Só encurta.
//    ⚠️ Os lookarounds são obrigatórios: `[\uD800-\uDFFF]` sem eles casa
//    cada metade de um par VÁLIDO e apagaria todo emoji astral.
function removerSubstitutosDesemparelhados(texto: string): string {
  return texto
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// Zalgo (issue 316): no máximo 3 marcas combinantes (Mn) seguidas. Aplicado
// DEPOIS da remoção de invisíveis — um CGJ (U+034F) entre marcas não burla o
// teto — e antes de qualquer medição de tamanho feita pelo chamador. Só encurta.
// Vietnamita decomposto usa 2 marcas: passa intacto. A observação de pedido NÃO
// passa por aqui (`normalizarObservacao` não limita Zalgo).
const RE_ZALGO = /(\p{Mn}{3})\p{Mn}+/gu;

/**
 * Passos 2, 3 e 8 de `normalizarObservacao`, sem trim nem colapso de espaço:
 * remove controles C0/C1 (preservando `\n` e `\t`), invisíveis e bidi (Trojan
 * Source, CVE-2021-42574), invisíveis não-bidi (3b) e substitutos
 * desemparelhados; depois limita Zalgo a 3 marcas combinantes. Só encurta.
 *
 * Reusada pela mensagem do modal sazonal (trecho, com `preservarJuncaoDeEmoji`)
 * e pelo título do modal (sem a opção). Quem precisa que `\t`/`\n`/U+2028
 * virem ESPAÇO troca antes de chamar: aqui `\t`/`\n` passam e U+2028 some.
 */
export function removerInvisiveisEControles(
  texto: string,
  opcoes?: { preservarJuncaoDeEmoji?: boolean },
): string {
  return removerSubstitutosDesemparelhados(
    removerControlesEInvisiveisBidi(texto, opcoes?.preservarJuncaoDeEmoji === true),
  ).replace(RE_ZALGO, "$1");
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonização para uso como IDENTIDADE (issue 168).
//
// Dois consumidores — mudar `normalizarObservacao` mexe nos dois:
//   1. `schemaObservacao` (src/lib/validacoes/pedido.ts) — gate AUTORITATIVO do
//      servidor: normaliza e só então mede o teto;
//   2. `linhaCarrinhoId` (src/hooks/useCarrinho.ts) — chave de dedup da linha do
//      carrinho, que por tabela governa a QUANTIDADE enviada no payload.
//
// Contrato: normaliza → corta em LIMITE_OBSERVACAO sem deixar high surrogate
// solto → normaliza de novo. É IDEMPOTENTE (a chave é rederivada a cada render
// a partir do valor já guardado: sem idempotência a linha mudaria de identidade
// entre dois renders) e só ENCURTA (herda a invariante do módulo).
export function canonizarObservacao(texto: string): string {
  const normalizado = normalizarObservacao(texto);
  if (normalizado.length <= LIMITE_OBSERVACAO) return normalizado;
  let corte = normalizado.slice(0, LIMITE_OBSERVACAO);
  const ultimo = corte.charCodeAt(corte.length - 1);
  // Não deixar metade de par substituto: o `.max()` do zod conta unidades UTF-16
  // (então o corte precisa ser por unidade), mas um high surrogate solto é UTF-8
  // inválido e o Postgres recusa o INSERT.
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) corte = corte.slice(0, -1);
  return normalizarObservacao(corte);
}
