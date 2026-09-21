# [278] Dias do vínculo em `/painel/produtos` e na linha "Está em:" do `FormProduto` (somente leitura)

**crítica:** NÃO — leitura derivada no servidor, sem controle novo e sem escrita
**Mundo:** painel + painel admin
**Depende de:** [273], [276]
**Spec:** specs/vigencia-por-item-do-cardapio.md — §Produtos do painel, RN-13

## Origem

Spec §Produtos do painel: a linha já diz de quais cardápios o produto participa (`CardapioDoProduto`,
issue 260). Passa a dizer **em que dias** — "Especiais do Dia (qua e sáb)". A agenda é editada onde
ela vive: o detalhe do cardápio.

## Objetivo

Expor a agenda por vínculo como texto, em somente leitura, nas duas superfícies de produto.

## Escopo

- [ ] `contrato-lote.ts`: `CardapioDoProduto` ganha `dias: number[] | null`
- [ ] `ProdutosClient.tsx` e a página `/painel/produtos` renderizam a frase derivada **no servidor**
- [ ] `FormProduto.tsx:744` (linha "Está em:") renderiza o mesmo rótulo, sem controle de edição
- [ ] Paridade admin em `/admin/assinantes/[lojaId]/produtos`

## Fora de escopo

- Qualquer campo novo em `schemaProduto` ou controle de edição de dias aqui
- Mudança em `carga-cardapios.ts` além de trazer a coluna que [273] já embutiu

## Reuso esperado

- `descreverVigencia.ts` para a frase (o browser nunca redige janela)
- `CardapioDoProduto` / `CardapiosPorProduto` em `contrato-lote.ts`
- `COLUNAS_CARDAPIO_VIGENCIA` de [273] — nenhuma query nova, nenhuma ida a mais ao banco

## Segurança

- Preview de UX puro: nenhuma decisão depende desta frase
- Nenhum dado sensível; nenhuma tabela nova tocada

## Critério de aceite

- [ ] Teste: produto vinculado com `dias_semana = [3,6]` ⇒ "Especiais do Dia (qua e sáb)";
      com `null` ⇒ frase sem sufixo de dias
- [ ] `npx vitest run src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx` verde
- [ ] `npx tsc --noEmit` = 0 · `npm run lint` = 0
