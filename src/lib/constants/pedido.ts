// Constantes de configuração do domínio de pedido (não é dado pessoal —
// permitido em código, seguranca.md §8).
//
// LIMITE_OBSERVACAO é a FONTE ÚNICA do teto de caracteres da observação:
//   - schema zod de entrada (src/lib/validacoes/pedido.ts) — gate AUTORITATIVO
//     do servidor, tanto para `itens[].observacao` quanto para `observacoes`
//     do pedido;
//   - `maxLength` do textarea e contador de caracteres na vitrine (issue 169) —
//     preview de UX, nunca autoridade;
//   - o CHECK/`left(...)` da RPC (issue 166) é defesa em profundidade.
//
// 🛑 PROIBIDO ADICIONAR QUALQUER `import` NESTE ARQUIVO — nem `zod`, nem
// `server-only`, nem nada. Componentes `'use client'` da vitrine importam esta
// constante; um import aqui arrastaria a dependência para o bundle público e
// reabriria silenciosamente a issue 163 (63,8 KB gzip de zod no checkout).
// Mesma disciplina de src/lib/constants/termos.ts.
export const LIMITE_OBSERVACAO = 200;
