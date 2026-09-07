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
      .trim()
      // 8. Substituto DESEMPARELHADO: `p_itens` é jsonb e o Postgres RECUSA
      //    UTF-8 malformado (`invalid input syntax for type json`), derrubando o
      //    pedido inteiro. Um navegador não produz isso pelo textarea, mas uma
      //    chamada forjada da Server Action produz. Só encurta.
      //    ⚠️ Os lookarounds são obrigatórios: `[\uD800-\uDFFF]` sem eles casa
      //    cada metade de um par VÁLIDO e apagaria todo emoji astral.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
  );
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
