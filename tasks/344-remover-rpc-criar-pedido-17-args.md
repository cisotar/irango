# [344] Remover a versão de 17 argumentos de `criar_pedido` (deploy seguinte)

**crítica:** SIM (TDD red-first)
**vetor:** V4 (função que grava pedido e valor)
**Mundo:** infra
**Depende de:** 341, 342 **já em produção** (migration aplicada no cloud e código chamando a RPC de 18 args)
**Spec:** specs/cliente-vinculo-pedido.md (Respostas do usuário, P1)

## Objetivo
Migration pequena que dá `drop function public.criar_pedido(<17 tipos>)`, num deploy posterior ao do Marco C,
para que o checkout nunca quebre na janela entre `db push` e deploy.

## Escopo
- [ ] Confirmar com `grep -rn "criar_pedido" src/` que nenhum caminho chama a versão de 17.
- [ ] Migration `<ts>_drop_criar_pedido_17_args.sql` com a assinatura exata (tipos dos 17).
- [ ] Teste em `tests/migrations/`: a de 17 não existe; a de 18 continua criando pedido de convidado e de cliente.
- [ ] Atualizar `references/schema.md`.

## Fora de escopo
Qualquer mudança de comportamento da RPC de 18.

## Segurança
- Sem mudança de grants na de 18. `db push` só com autorização humana.

## Critério de aceite
- [ ] Teste vermelho (de 17 ainda existe) → verde após a migration.
- [ ] Suíte e gate C3 verdes.

## Dúvidas
- `tasks/266` (drop da de 16 args) segue aberta. Faz sentido entregar 266 e 344 na mesma migration de contract (dropar 16 e 17 juntas)? Decisão do usuário; manter separadas por padrão.
