# 182 — bug de edição de zona de frete já cadastrada (upsert sem índice único)

crítica: SIM (integridade de dado monetário — `taxas_entrega.taxa` — e requer migration)

## Origem

Pedido literal do usuário, registrado em `plan/loop-frete-faixas-e-edicao-de-zona.md` §0:

> 2 - resolver bug que impede edição de frete por zona já cadastrado.

Sem passos de reprodução, sem mensagem de erro, sem indicar painel do lojista ou hub admin —
diagnosticado pelo agente `depurar` na Fase 0 deste loop (2026-09-09).

## Causa raiz (reproduzida mecanicamente pelo `depurar`)

`taxas_entrega` **não tem índice único nem exclusion constraint em `zona_id`** — o único índice único
da tabela é o da PK em `id` (confirmado via `createTestDb()` com as 51 migrations aplicadas em ordem).

`src/lib/actions/entrega.ts:177` e `src/app/admin/assinantes/actions/admin-entrega.ts:131` fazem
`.upsert({ ...taxa, zona_id: id }, { onConflict: "zona_id" })`. Sem índice único correspondente, o
Postgres recusa o `ON CONFLICT (zona_id)` com **erro `42P10`** ("there is no unique or exclusion
constraint matching the ON CONFLICT specification") — reproduzido tanto como dono autenticado
(caminho do painel do lojista) quanto como `service_role` (caminho do hub admin, que tem BYPASSRLS).
Afeta **os dois painéis**.

`criarZona` usa `.insert` (não `.upsert`) e por isso funciona — só a edição de zona já cadastrada
quebra, batendo com o relato do usuário. O erro fica só no log do servidor
(`entrega.ts:180` mostra "Não foi possível salvar a taxa." genérico ao cliente), por isso o usuário
não tinha mensagem de erro para reportar. Build e suíte ficam verdes porque nenhum teste hoje exercita
o `.upsert` contra Postgres real (só contra mocks).

Consequência adicional provada pelo `depurar`: sem o índice único, é possível hoje existir **mais de
uma taxa para a mesma zona** — o que já deixa `src/lib/supabase/queries/entregaPagamento.ts:55`
(`taxa: Array.isArray(taxa) ? taxa[0] : ...`) escolhendo uma taxa arbitrária quando há duplicata.

Hipóteses alternativas descartadas com evidência pelo `depurar`: RLS bloqueando UPDATE (UPDATE puro
passa; falha idêntica sob `service_role` com BYPASSRLS), `PGRST204`/migration só-local
(`npx supabase migration list` sem linha com Remote vazia), prop de Server Action obrigatória faltando
(#160 — não há instância residual), update sem escopo por `loja_id` (escopo correto nas duas pontas,
sem vazamento cross-tenant).

## Causa raiz é a mesma do #181?

**Não.** São fraquezas relacionadas do mesmo modelo de zona (a cardinalidade 1:1 zona→taxa hoje só é
convenção, não é imposta pelo schema), mas #181 é mudança de regra de negócio (faixa exclusiva vs.
menor taxa) e #182 é ausência de constraint de integridade. Corrigir uma não corrige a outra.

## Fix mínimo proposto pelo `depurar`

- **Migration com índice único (recomendada):** `CREATE UNIQUE INDEX ... ON taxas_entrega (zona_id)`,
  precedida de verificação/dedup no cloud (`select zona_id, count(*) from taxas_entrega group by 1
  having count(*) > 1`) — o teste do `depurar` provou que duplicata é possível hoje, então a migration
  precisa tratar isso antes de criar o índice, senão a criação falha. Corrige o `42P10` e torna
  determinístico o `taxa[0]` de `entregaPagamento.ts:55`.
- Alternativa sem migration (`UPDATE` + fallback `INSERT` se 0 linhas afetadas) foi descartada como
  paliativa: não impede duplicata em saves concorrentes nem remove o não-determinismo do preview de
  frete. Não usar como solução final.

`precisa_migration: true` — confirmado pelo `depurar`. Esta issue entra na mesma branch
(`fix/frete-faixas-exclusivas`) e no mesmo `db push` do #181 (bifurcação 2b do plano), para gastar uma
única autorização humana de migration.

## Escopo da migration (a detalhar pelo agente `migrar`)

Trata `taxas_entrega` como tabela **com dados** — expand → backfill (dedup) → contract (índice único).
`migrar` precisa responder explicitamente o que acontece se já existirem duas taxas para a mesma
`zona_id` no cloud antes de criar o índice.

## Arquivos prováveis

- `supabase/migrations/<novo>_taxas_entrega_zona_id_unique.sql` (índice único + dedup).
- `src/lib/actions/entrega.ts:177` — nenhuma mudança de código deveria ser necessária se o `.upsert`
  já assume o índice único; confirmar com teste.
- `src/app/admin/assinantes/actions/admin-entrega.ts:131` — idem.
- Teste de reprodução em `tests/migrations/` cobrindo o `42P10` antes do fix e o `.upsert` funcionando
  depois.

## Fora de escopo desta issue

- `schemaTaxa` (`src/lib/validacoes/entrega.ts:17-25`) não valida `cep_inicio`/`cep_fim`, então zona
  `faixa_cep` perde a faixa ao salvar (`calcularFrete.ts:88` trata `cep_inicio`/`cep_fim` nulos como
  "não atende"). Achado colateral do `depurar`, nenhuma loja em produção usa CEP hoje — vira issue
  própria em `tasks/`, não corrigir aqui.
