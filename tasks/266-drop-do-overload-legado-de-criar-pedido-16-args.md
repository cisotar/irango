# [266] Drop do overload legado de `criar_pedido` com 16 argumentos (fase contract)

**crítica: SIM** — o caminho perde o snapshot de preço do pedido sem erro.

**Depende de:** 229 (`criarPedido` snapshot + RN-12-a)

## Origem

Achado do `tdd` na fase RED da issue 221, confirmado pelo `auditar` (severidade MÉDIA)
no commit `9aa68bc`, branch `feat/promocoes-nucleo-monetario`.

## Objetivo

Existem hoje duas `public.criar_pedido` vivas:

- a legada de 16 argumentos, definida em
  `supabase/migrations/20260907120000_itens_pedido_observacao.sql:203-214`;
- a atual de 17, com `p_idempotency_key` e `p_frete_a_combinar`, cuja última versão é
  `supabase/migrations/20260920127000_rpc_criar_pedido_preco_original.sql`.

Uma chamada nomeada que omita os dois últimos argumentos **não** dá `function is not unique`:
o Postgres resolve para a de 16 args, porque ela tem menos defaults a preencher. Essa versão
**ignora `preco_original` em silêncio**, sem erro nenhum. O pedido grava, o valor pago fica
correto, e o par de preços do D7 se perde — a vitrine deixa de exibir "de/por" (RN-14) para
aquele pedido e ninguém percebe.

Não é vetor de atacante: as duas assinaturas têm `EXECUTE` só para `service_role`. É
regressão de desenvolvedor, e não há gate mecânico que a pegue: `tsc` não vê assinatura de
RPC, e a suíte só cobre o ramo a-combinar por acidente
(`src/lib/actions/pedido.test.ts:1118` e `:2296`).

A janela de deploy que justificou manter a legada fechou quando o deploy da 180-B completou;
a própria `20260913121000_rpc_criar_pedido_frete_a_combinar.sql:8-18` já marcou o `drop` como
fase contract "em issue própria pós-produção".

## Escopo

1. Migration com `drop function public.criar_pedido(<os 16 tipos na ordem exata da definição
   em 20260907120000>)`. Os tipos vêm do arquivo, nunca de memória.
2. Reescrever o caso `[221 · armadilha de overload]` em
   `tests/migrations/itens_pedido_preco_original.test.ts`: hoje ele **afirma o comportamento
   errado como esperado** (a chamada de 16 args grava `preco_original` NULL). Passa a ser
   `rejects` com o fragmento `does not exist` na mensagem.
3. Ajustar o caso `[221 · contrato]` que conta as assinaturas vivas: de "a legada de 16 args
   continua existindo" para contagem zero.

## Fora de escopo

- Fazer a legada levantar exceção em vez de sumir. Isso mantém a ambiguidade de overload viva
  e ainda depende de alguém ler a mensagem; ausente, a chamada errada falha imediatamente em
  runtime e na suíte pglite.
- Qualquer mudança na assinatura de 17 args.

## Reuso esperado

- O corpo vigente da RPC não é tocado: esta issue só remove a definição antiga.

## Segurança

- `drop function` é irreversível no cloud: pedir autorização antes do `db push`, e confirmar
  antes que nenhum caller em `src/` chama com 16 argumentos
  (`src/lib/actions/pedido.ts:400-433` passa os 17 hoje).
- Rollback: reexecutar o corpo da `20260907120000`, nunca recriar de memória.

## Critério de aceite

- `select count(*) from pg_proc where proname = 'criar_pedido'` devolve 1.
- A chamada de 16 argumentos falha com `does not exist`, afirmado por fragmento de mensagem.
- A suíte de checkout e pedido passa sem nenhuma outra edição.
