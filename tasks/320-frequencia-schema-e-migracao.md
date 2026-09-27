# 320 — Frequência de exibição: schema, view pública e migração de dados

Spec: `specs/frequencia-exibicao.md` (§Banco, RN-2, RN-4)
Plano: `plan/loop-frequencia-exibicao.md` (fatia I1)
Crítica: SIM (migration em tabela populada, view pública `security_barrier`, UPDATE em produção)

## O que fazer

Migration `supabase/migrations/2026092813xxxx_frequencia_produtos_categorias.sql`
(timestamp > 20260927125000):

- colunas de frequência em `produtos` e `categorias` (dias da semana, faixa de
  horário, período de datas; NULL = sem restrição — S1–S4 do plano);
- CHECKs de coerência (molde: `20260920128000_cardapios_checks_vigencia_rls.sql` e
  CHECK de `dias_semana` 0..6 de `20260921130000_*`);
- `categorias.oculta boolean not null default false`;
- `vitrine_produtos` recriada: exclui produto de categoria oculta, colunas novas só
  NO FIM, `security_invoker=false, security_barrier=true`, revoke/grant no mesmo arquivo;
- `update produtos set visibilidade='menu' where visibilidade='cardapio'` (o trigger
  RN-14 só dispara `when new.visibilidade = 'cardapio'`).

## Prova (tabela Risco, linha I1)

`tests/migrations/frequencia-*.test.ts`: insert com `hora_fim` sem `hora_inicio` /
`hora_inicio >= hora_fim` / `periodo_fim < periodo_inicio` / dia 7 → FAIL com SQLSTATE
23514 **e** nome da constraint na mensagem; `asAnon` lê `vitrine_produtos` e não
enxerga produto de categoria oculta nem de loja inativa; `reloptions` da view contém
`security_barrier=true`; após migration, `count(*) where visibilidade='cardapio'` = 0 e
`cardapio_produtos` intacto.

## Não fazer

`db push` (humano); apagar tabelas/colunas de cardápio.
