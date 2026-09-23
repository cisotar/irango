# [298] Harness pglite reconcede SELECT em tabela base depois das migrations

**crítica: NÃO** — baixa severidade, sem exploração conhecida; higiene de infraestrutura de teste.

## Origem

Auditoria da issue 294 sobre o commit `2f7b0cb` (branch `fix/294-pedidos-remove-insert-publico`).

## O problema

`tests/helpers/pglite.ts` (`GRANTS_SQL`) ainda roda, depois das migrations,
`grant select on all tables in schema public to anon, authenticated;`. A 294 já removeu o laço
equivalente para `insert, update, delete` (mascarava revoke de escrita em teste). O mesmo problema
persiste para SELECT: o grant amplo desfaz qualquer `revoke select` feito por uma migration —
por exemplo `taxas_entrega_duplicadas_182` (`20260909120000:65`, `revoke all` explícito) e
`admin_acessos` (que não tem grant de SELECT no cloud).

Hoje nada fica exposto na prática, porque a RLS nega a leitura mesmo com o grant. Mas um
`revoke select` futuro feito por migration não é testável: o teste daria verde mesmo que o grant
real no cloud continuasse aberto — a mesma classe de falso-verde que a 294 fechou para escrita.

## Correção proposta

Remover (ou restringir por tabela) o `grant select on all tables` do `GRANTS_SQL` em
`tests/helpers/pglite.ts`, seguindo o mesmo raciocínio já documentado no docblock do arquivo desde
a 294: os roles existem antes das migrations, então as próprias migrations reproduzem o ACL de
SELECT do cloud sem precisar do laço.

## Critério de aceite

- [ ] Remover o `grant select on all tables` do `GRANTS_SQL` (ou substituir por algo que não
      mascare revoke de SELECT feito por migration)
- [ ] Rodar `tests/migrations/` inteiro e catalogar qualquer falha nova — cada uma indica tabela
      onde alguma migration esqueceu o grant de SELECT (mesmo padrão do achado da 294)
- [ ] Ajustar asserções afetadas, se houver, sem afrouxar o que já provam
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`

## Fora de escopo

Grant de INSERT/UPDATE/DELETE em tabela base (já resolvido pela 294). Qualquer mudança em `src/`.
