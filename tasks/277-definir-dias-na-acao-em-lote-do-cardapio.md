# [277] Ação "Definir dias" no diálogo de lote do cardápio (lojista + admin)

**crítica:** NÃO — usa o caminho de escrita já travado em [274] e a prévia do servidor que já existe
**Mundo:** painel + painel admin
**Depende de:** [274], [276]
**Spec:** specs/vigencia-por-item-do-cardapio.md — §Detalhe do cardápio (behavior do lote), RN-09 da spec-mãe

## Origem

Spec §Componentes: "entra a ação **Definir dias** no diálogo de alcance que já existe, com a mesma
prévia vinda do servidor e a mesma trava de o número ir dentro do rótulo do botão. **Nenhum segundo
caminho de escrita e nenhuma segunda redação de confirmação.**"

## Objetivo

Permitir definir a mesma agenda para vários produtos de uma vez, dentro do diálogo de lote existente.

## Escopo

- [ ] `contrato-lote.ts`: a ação "Definir dias" entra em `AcoesLote` com o payload de dias
- [ ] `DialogoLoteCardapio.tsx` + `useLoteDeProdutos`: seleção de dias no diálogo de alcance existente,
      prévia vinda de `preverLoteAction` (o cliente não conta nada)
- [ ] O número de produtos afetados vai **dentro** do rótulo do botão de confirmação (trava existente)
- [ ] Paridade admin pela mesma via neutra
- [ ] Nenhuma segunda redação de confirmação: a frase é a que já existe

## Fora de escopo

- Criar uma action de lote nova: a escrita é a de [274] aplicada aos pares selecionados
- Copiar agenda de um item para outro / templates de semana (§Fora do Escopo)
- Mudar a contagem da prévia ou a semântica do alcance do lote

## Reuso esperado

- `DialogoLoteCardapio`, `useLoteDeProdutos`, `contrato-lote.ts`, `preverLoteAction`
- `PilulasDeDias` ([275]) para escolher os dias dentro do diálogo
- `lote-contagem-do-servidor.test.ts` como gate de "o cliente não conta"
- `MSG_GENERICA_LOTE` / `MSG_DIAS_DO_VINCULO` — mensagens já existentes

## Segurança

- Caminho de escrita é o mesmo corrigido em [270] e travado em [274]: `loja_id` da sessão/URL,
  FK composta como trava estrutural, mensagem única para alheio e inexistente
- A contagem da prévia vem do servidor; o cliente nunca decide alcance

## Critério de aceite

- [ ] Teste: "Definir dias" no lote com N produtos ⇒ N escritas escopadas, prévia do servidor conferindo N
- [ ] Teste: o rótulo do botão contém o número vindo do servidor
- [ ] `npx vitest run src/components/painel/` verde · `npx tsc --noEmit` = 0 · `npm run build` verde
