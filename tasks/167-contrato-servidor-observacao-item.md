# [167] Contrato do servidor: `LIMITE_OBSERVACAO` + zod + normalização em `criarPedido`

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública (Server Action)
**Depende de:** 166
**Spec:** specs/observacoes-por-item-pedido.md

## Objetivo

Estabelecer o **gate autoritativo de tamanho** da observação no servidor: uma
constante única `LIMITE_OBSERVACAO = 200`, o campo declarado em `schemaItemPedido`
(que é `.strict()`), a redução de `observacoes` do pedido de 500 para 200, e a
propagação normalizada do texto para `p_itens` em `criarPedido`.

## Escopo

- [ ] Criar `src/lib/constants/pedido.ts` com
      `export const LIMITE_OBSERVACAO = 200;` — **fonte única** do número, em módulo
      sem dependência de zod nem de `server-only`, porque componentes de cliente
      (issue 169) importam essa constante e não podem arrastar zod para o bundle
      público (ver issue 163).
- [ ] `src/lib/validacoes/pedido.ts`: `schemaItemPedido` ganha
      `observacao: z.string().trim().max(LIMITE_OBSERVACAO).optional()`.
      **Sem esta linha o `.strict()` rejeita o payload inteiro** quando o cliente
      manda o campo — o checkout quebra por completo, não só a observação.
- [ ] `src/lib/validacoes/pedido.ts`: `schemaPayloadPedido.observacoes` passa de
      `.max(500)` para `.max(LIMITE_OBSERVACAO)` (~l.86). Sem migration — a coluna
      `pedidos.observacoes` nunca teve CHECK; pedidos antigos maiores continuam
      válidos e legíveis, o teto novo vale só para pedidos novos.
- [ ] `src/lib/actions/pedido.ts`: no `itensSnapshot.push({...})` (~l.180), propagar
      `observacao` normalizada (`trim()`, vazio → campo ausente), no mesmo padrão
      condicional já usado por `opcionais`. Aceitar `\n` — sem `.regex` de linha
      única.
- [ ] Testes em `src/lib/validacoes/pedido.test.ts` (arquivo existente): 200 chars
      aceito, 201 rejeitado, `\n` aceito, campo ausente aceito, campo desconhecido
      no item continua barrado pelo `.strict()`, `observacoes` do pedido com 201
      rejeitado.

## Fora de escopo

- `maxLength` do textarea e qualquer UI → issue 169.
- Estado do carrinho e chave de dedup → issue 168.
- Alterar a lógica de recálculo de valor: a observação **não** entra nele.

## Reuso esperado

- `src/lib/constants/termos.ts` — precedente de constante compartilhada em
  `src/lib/constants/`; seguir o padrão (comentário explicando quem consome).
- `src/lib/validacoes/pedido.ts` — estender `schemaItemPedido`, não criar schema novo.
- `src/lib/actions/pedido.ts` — o `itensSnapshot` já existe; só acrescentar o campo.
- `src/lib/validacoes/pedido.test.ts` — estender.

## Segurança

- Input **não-confiável** do cliente. Este é o gate real de tamanho
  (`seguranca.md` §10: nunca confiar no cliente); o `maxLength` da issue 169 é
  preview e o CHECK da 166 é defesa em profundidade.
- Normalização no servidor: `trim()`, vazio → ausente (a RPC transforma em `NULL`).
- O `.strict()` do `schemaItemPedido` é a trava contra injeção de valores
  monetários — declarar `observacao` **não pode** afrouxá-lo: nenhum
  `.passthrough()`, nenhum `.catchall()`.
- **Valor monetário:** nenhum. O recálculo autoritativo de subtotal/frete/desconto/
  total ignora completamente a observação. Confirmar em teste que o total não muda
  com e sem observação.
- Nenhuma tabela nova, nenhuma policy nova.

## Critério de aceite

- [ ] Teste vermelho escrito e com `FAIL` capturado antes do código de produção.
- [ ] Payload de item com `observacao` de 200 chars passa no `safeParse`; com 201
      falha; com `\n` no meio passa.
- [ ] Payload de item com um campo desconhecido continua reprovado pelo `.strict()`.
- [ ] `schemaPayloadPedido.observacoes` com 201 chars é reprovado.
- [ ] Um pedido criado com e sem observação produz **o mesmo total** recalculado.
- [ ] `grep -rn "\.max(500)" src/lib/validacoes/pedido.ts` sem resultado.
- [ ] `grep -rn "200" src/lib/validacoes/pedido.ts` não mostra literal do limite —
      só o import de `LIMITE_OBSERVACAO`.
- [ ] `npm run build` verde (`const` exportada em `'use server'` só quebra aqui).
