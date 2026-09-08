# [174] Verificar a recusa de forma de pagamento não cadastrada

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** smoke manual da issue 159 (2026-09-07). O ponto 3 do roteiro —
payload forjado com forma de pagamento não cadastrada — não foi exercitado.

## Problema

`criarPedido` recusa forma de pagamento fora das cadastradas pela loja
(`src/lib/actions/pedido.ts:118-121`), e há teste unitário cobrindo isso
(`[159-C2]` e `[159-C3]` em `pedido.test.ts`). O que nunca foi verificado é o
caminho ponta a ponta: forjar o payload de fato e confirmar que a Server Action
recusa com a mensagem genérica, sem vazar detalhe.

Hoje a UI já renderiza **apenas** as formas cadastradas — `formasPagamento.map`
em `src/components/vitrine/checkout/EtapaPagamento.tsx:215`, alimentado por
`listarFormasPagamento`. Ou seja, o caminho não é alcançável pela vitrine
legítima. Isso é bom, mas é exatamente por isso que a recusa nunca é exercida
na prática e pode apodrecer sem ninguém notar.

## Por que isso importa mais do que parece

A decisão da issue 159 (paralelizar as leituras de `criarPedido`) se apoia
justamente nessa premissa: o ramo de forma de pagamento inválida é **raro por
construção**, logo trocar a economia do `return` antecipado por latência menor
no caminho de sucesso compensa. A premissa está registrada em
`performance/2026-09-07-159-paralelizar-leituras-criarpedido.md`.

Se um dia a UI passar a oferecer uma forma não cadastrada — bug de query, cache
servindo lista velha, feature de "formas sugeridas" — a premissa cai junto, e
ninguém é avisado.

## Escopo

- [ ] Teste ponta a ponta forjando o payload com `forma_pagamento` fora das
      cadastradas: recusa com a mensagem genérica, sem `rpc`, sem vazar detalhe
      de PostgREST/schema.
- [ ] Teste de contrato garantindo que a lista renderizada na vitrine é
      **subconjunto** das formas cadastradas da loja — a trava que sustenta a
      premissa da 159.

## Critério de aceite

- [ ] Payload forjado é recusado com `ERRO_GENERICO`, sem `rpc` chamada.
- [ ] Nenhum detalhe interno no retorno ao cliente (`seguranca.md` §14).
- [ ] A UI não consegue oferecer forma não cadastrada, provado por teste e não
      por inspeção.

## Relacionada

- `performance/2026-09-07-159-paralelizar-leituras-criarpedido.md` — a premissa
  que este teste protege.
