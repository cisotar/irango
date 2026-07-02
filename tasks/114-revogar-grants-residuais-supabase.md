# [114] Hardening: revogar grants residuais de anon/authenticated

**crítica:** NÃO
**Mundo:** infra (grants/migration)
**Depende de:** [112 — Revogar escrita anônima em `vitrine_lojas` e execução de `loja_por_email_dono`] (contexto histórico; 112 já está pronta e fechou os dois furos críticos)
**Spec:** specs/vitrine_lojas_select_only.md

## Objetivo

Limpar dois resíduos de baixa severidade encontrados pela auditoria da issue 112: privilégios
concedidos a `anon`/`authenticated` pela causa raiz (`GRANT ALL ON ALL ROUTINES/TABLES` da
migration `20260614008500_grants_roles_supabase.sql`) que **não são exploráveis hoje**, mas
continuam concedidos por omissão. Nenhum dos dois é um furo de segurança ativo — é limpeza
estrutural para fechar a causa raiz de forma mais completa, reduzindo superfície residual sem
mudar nenhum contrato de acesso observável.

## Escopo

- [ ] **Resíduo 1 — `rls_auto_enable()`:** revogar `EXECUTE` da função event-trigger
  `SECURITY DEFINER` `rls_auto_enable()` de `anon`, `authenticated` e `public`. Ela foi
  re-grantada pelo `GRANT ALL ON ALL ROUTINES IN SCHEMA public` da `20260614008500`, mas não é
  chamável como RPC comum (é acionada apenas pelo mecanismo de event trigger do Postgres, não
  por `POST /rest/v1/rpc/rls_auto_enable`) — confirmar isso antes de revogar, para documentar
  por que é inerte.
- [ ] **Resíduo 2 — privilégios inertes em `vitrine_lojas`:** trocar o `revoke insert, update,
  delete on public.vitrine_lojas from anon, authenticated` da `20260702140000` por
  `revoke all on public.vitrine_lojas from anon, authenticated`, seguido do já existente
  `grant select on public.vitrine_lojas to anon, authenticated`. Isso remove `TRUNCATE`,
  `TRIGGER` e `REFERENCES` (concedidos pelo mesmo `GRANT ALL ON ALL TABLES` da `008500` e nunca
  revogados — `insert, update, delete` foi o único revoke explícito). Nenhum desses três
  privilégios é explorável numa view (`TRUNCATE`/`TRIGGER` não se aplicam a views;
  `REFERENCES` não se aplica sem FK apontando para ela), mas ficam residuais sem necessidade.
- [ ] Criar `supabase/migrations/<timestamp>_revoke_grants_residuais.sql` (timestamp posterior à
  última migration existente no momento da implementação) com:
  ```sql
  -- Hardening (não-crítico): fecha resíduos de baixa severidade da 20260614008500
  -- identificados na auditoria da issue 112. Nenhum dos dois é explorável hoje —
  -- ver comentários abaixo — mas ambos são revogáveis sem custo de contrato.

  -- 1) rls_auto_enable(): função event-trigger SECURITY DEFINER, não é chamável
  --    via RPC (POST /rest/v1/rpc/rls_auto_enable não a alcança — só o mecanismo
  --    de event trigger do Postgres a invoca). Revoga por limpeza estrutural.
  revoke all on function public.rls_auto_enable() from anon, authenticated, public;

  -- 2) vitrine_lojas: troca revoke parcial (insert/update/delete) por revoke all,
  --    fechando também TRUNCATE/TRIGGER/REFERENCES (inertes em view, mas residuais).
  --    grant select reafirmado na sequência para não regredir leitura pública.
  revoke all on public.vitrine_lojas from anon, authenticated;
  grant select on public.vitrine_lojas to anon, authenticated;
  ```
  Idempotente — reaplicável sem erro.
- [ ] Testar localmente com pglite antes de qualquer deploy: rodar a suíte de migrations
  existente sem regressão, com foco em:
  - `tests/migrations/vitrine_lojas_select_only.test.ts` (os 5 asserts de comportamento + guarda
    estática da issue 112) — confirmar que `SELECT` público continua funcionando e que
    `INSERT`/`UPDATE`/`DELETE` continuam rejeitados após trocar para `revoke all` + `grant
    select`.
  - `rls_lojas.test.ts`, `queries_lojas.test.ts`, `logo_url_vitrine.test.ts`,
    `loja_por_email.test.ts`, `frete.test.ts` — nenhum deve depender de `EXECUTE` em
    `rls_auto_enable()` por `anon`/`authenticated` (é função interna de infraestrutura, não
    chamada pelo código de aplicação).
- [ ] `next build` sem erros (mandato do projeto).
- [ ] Documentar no corpo da migration (comentário SQL, como acima) **por que** cada resíduo é
  inerte hoje e **por que** ainda vale a pena revogar (defesa em profundidade — reduz o que um
  futuro bug de RLS/policy poderia explorar através desses privilégios, mesmo que hoje não haja
  caminho de exploração).

## Fora de escopo

- Reabrir a investigação de exploração — a auditoria da issue 112 já confirmou que ambos os
  resíduos são inertes; esta issue não questiona essa conclusão, só limpa.
- Qualquer mudança em `loja_por_email_dono` ou nas colunas/policies de `lojas` — já corrigidas na
  112.
- Atualizar `references/seguranca.md §19` — se ainda pendente da 112/113, tratar na issue
  correspondente, não aqui (a menos que o `documentar` já esteja rodando como parte do fechamento
  desta issue e queira registrar os dois resíduos como nota de rodapé histórica).
- Mudar `GRANTS_SQL` de `tests/helpers/pglite.ts` além do necessário para refletir o novo
  `revoke all` — se algum teste existente dependia implicitamente de `TRUNCATE`/`TRIGGER`/
  `REFERENCES` em `vitrine_lojas` via `anon`/`authenticated` (não deveria, mas confirmar), ajustar
  o harness é parte do escopo; introduzir grants novos não é.

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb`, `asAnon`, `asService`; não criar harness novo.
- `tests/migrations/vitrine_lojas_select_only.test.ts` (issue 112) — estender ou reexecutar, não
  duplicar os asserts de leitura pública/escrita negada.
- SQL da migration `20260702140000_vitrine_lojas_revoke_escrita.sql` como base — esta issue só
  amplia o `revoke` já existente, não redesenha a abordagem.

## Segurança

- Dado sensível ou valor monetário: não, diretamente — ambos os privilégios revogados aqui são
  confirmados como não-exploráveis (função não chamável via RPC; TRUNCATE/TRIGGER/REFERENCES
  inertes em view). O ganho é defesa em profundidade, não fechamento de um furo ativo.
- Autorização/RLS: nenhuma policy nova; apenas `revoke`/`grant` de privilégios de objeto
  (função e view), mesma família de mudança da issue 112.
- Tabela/objeto tocado: `public.rls_auto_enable()` (função) e `public.vitrine_lojas` (view) —
  ambos já tocados pela 112; esta issue completa o revoke.

## Critério de aceite

- [ ] Migration nova aplicada localmente (pglite) sem quebrar nenhum teste existente.
- [ ] `pnpm vitest tests/migrations/vitrine_lojas_select_only.test.ts` continua verde após a
  troca de `revoke insert, update, delete` por `revoke all` + `grant select`.
- [ ] Suíte de migrations existente sem regressão (`rls_lojas`, `queries_lojas`,
  `logo_url_vitrine`, `loja_por_email`, `frete`).
- [ ] `next build` sem erros.
- [ ] Comentário SQL na migration explica, para cada resíduo, por que é inerte e por que vale a
  pena revogar mesmo assim (documentação embutida, não depende de um segundo arquivo).
