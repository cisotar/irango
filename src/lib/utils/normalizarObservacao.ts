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
  return (
    texto
      // 1. CRLF/CR → LF: uma só representação de quebra de linha (a comanda imprime LF).
      .replace(/\r\n?/g, "\n")
      // 2. Controles C0/C1 e DEL, PRESERVANDO \n (U+000A) e \t (U+0009).
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      // 3. Invisíveis/bidi: zero-width, separadores de linha/parágrafo, BOM e
      //    TODA a família de controle bidirecional — overrides (U+202A-202E),
      //    isolates (U+2066-U+2069, o par do Trojan Source, CVE-2021-42574),
      //    format chars depreciados (U+206A-206F) e o ALM (U+061C). Sem eles a
      //    comanda impressa pode ser reordenada visualmente: o lojista lê algo
      //    diferente do que está gravado.
      .replace(/[\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
      // 4. Tab → espaço (tab quebra alinhamento de comanda/recibo).
      .replace(/\t/g, " ")
      // 5. Colapsa espaço horizontal repetido (inclui NBSP) — anti-padding.
      .replace(/[^\S\n]{2,}/g, " ")
      // 6. No máximo uma linha em branco entre parágrafos.
      .replace(/\n{3,}/g, "\n\n")
      // 7. Bordas: o trim() do JS remove \n, \r, \t e NBSP (o btrim do Postgres NÃO).
      .trim()
  );
}
