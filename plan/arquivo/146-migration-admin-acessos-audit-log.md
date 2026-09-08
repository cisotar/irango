## Plano Técnico

> Issue crítica (TDD red-first). Migration de tabela nova `admin_acessos` com RLS
> deny-all. Pré-requisito de dados da issue 147 (`registrarAcessoAdmin`, hoje no-op —
> `seguranca.md:482`).

### Análise do Codebase

**O que já existe e será reusado (não reinventar):**

- `supabase/migrations/20260614000129_schema_inicial.sql:166-189` — **esqueleto deny-all exato** de `webhook_eventos_hotmart`: `create table` + `alter table ... enable row level security` **sem `create policy`**. É o padrão a copiar. Confirmado deny-all real (não só intenção): `grep` de `policy` sobre `webhook_eventos_hotmart` em todas as migrations retorna **só o comentário** "permanece sem policy (estado final)" — nenhuma migration posterior adiciona policy. RLS habilitada + zero policy = deny-all para `anon`/`authenticated`; só `service_role` (BYPASSRLS) acessa.
- `tests/migrations/schema_inicial.test.ts:490-557` — describe `"webhook_eventos_hotmart é deny-all (RLS sem policy)"`: **teste RLS negativo já existente** que o `tdd` deve espelhar linha a linha (anon não lê / anon não insere / authenticated não lê / service_role lê+escreve).
- `tests/helpers/pglite.ts` — harness `createTestDb(): Promise<TestDb>`. Assinaturas exatas confirmadas:
  - `asAnon: <T>(fn: (db: PGlite) => Promise<T>) => Promise<T>`
  - `asUser: <T>(userId: string, fn: (db: PGlite) => Promise<T>, email?: string) => Promise<T>`
  - `asService: <T>(fn: (db: PGlite) => Promise<T>) => Promise<T>`
  - `db: PGlite`, `close: () => Promise<void>`
  - Cada `asX` roda em transação + `set local role` + `set_config('request.jwt.claims', ...)`.
  - **Ponto-chave:** o bloco `GRANTS_SQL` concede `insert, update, delete` a `anon`/`authenticated` em **todas** as tabelas de `public` (loop sobre `pg_tables`) — inclusive `admin_acessos`. Logo o deny-all é garantido **pela RLS** (RLS sem policy = nega), não por ausência de grant. É exatamente o que valida o teste do webhook, e o que provará o isolamento de `admin_acessos`.
- `tests/migrations/rls_lojas.test.ts` — padrão geral de teste de migration RLS (IDs fixos, `garantirDonos` em `auth.users`, `criarCenario` via `asService`, anti-falso-verde). Fonte do enquadramento RED "os testes de NEGAÇÃO passam por excesso de deny-all — não são o que prova o RED".
- `tests/migrations/pedidos_loja_id_cascade.test.ts` — padrão de teste de **regra de FK on delete** (assert em `information_schema.referential_constraints.delete_rule` + delete real da loja). Espelho para a asserção de cascade recomendada abaixo.
- `src/lib/database.types.ts:853-897` — bloco de tipos de `webhook_eventos_hotmart` (Row/Insert/Update/Relationships). Molde exato do patch manual de `admin_acessos`.
- Convenção de índice `pedidos(loja_id, criado_em desc)` (`schema.md §3`) e convenção `schema.md §6`: "ON DELETE CASCADE em dados filhos da loja — deletar loja limpa tudo".

**O que precisa ser criado:**

- `supabase/migrations/20260707122000_admin_acessos.sql` (timestamp livre — confirmado abaixo).
- `tests/migrations/rls_admin_acessos.test.ts` (fase RED do `tdd`).
- Bloco de tipos `admin_acessos` em `src/lib/database.types.ts` (patch manual determinístico).

### Confirmação 1 — Timestamp `20260707122000` está livre

Última migration do repo: `20260707121000_lojas_protege_billing_v3_modulos.sql`. Não existe nenhum arquivo `>= 20260707122000`. **Timestamp livre — confirmado.**

### Confirmação 2 — Esqueleto deny-all

`enable row level security` **sem nenhuma `create policy`** = deny-all para `anon`/`authenticated`; só `service_role` (BYPASSRLS) acessa. Verificado nas duas pontas:
1. Estático: nenhuma migration adiciona policy a `webhook_eventos_hotmart` (grep confirma).
2. Comportamental: `schema_inicial.test.ts:490-557` prova em pglite que anon/authenticated não leem nem inserem, e service_role sim.

Copiar o padrão. Não inventar RLS nova, não adicionar policy de SELECT (deny-all puro — consulta futura é via `service_role`, fora de escopo).

### Confirmação 3 — FK `loja_id` (DECISÃO: `on delete cascade`)

**Existe hard-delete de loja no projeto.** `src/lib/supabase/queries/adminAssinatura.ts:44-54` (`excluirLojaPermanente`, issue 084) executa **um único** `DELETE FROM lojas WHERE id=$1` sob `service_role` e depende **inteiramente do cascade de FK** para limpar filhos — não deleta filhos manualmente. Migration `20260621096000` trocou `pedidos.loja_id` para `on delete cascade` exatamente por isso; `20260621097000` removeu a policy de DELETE do lojista, tornando o hard-delete admin (service_role) a única via.

**Problema do SQL do rascunho** (`loja_id uuid not null references public.lojas(id)` = NO ACTION/RESTRICT): `admin_acessos` terá uma linha para **toda** ação admin sobre a loja (`criar_loja`, `salvar_tema`, `alternar_modulo`). Toda loja administrada terá linhas aqui. Com RESTRICT, o `DELETE FROM lojas` do hard-delete **falharia** com `foreign_key_violation` — quebrando o fluxo da issue 084 (exatamente o bug que a migration 096 corrigiu para `pedidos`). É um bug latente: o plano de teste do rascunho não deleta loja, então **não pegaria** essa regressão.

**Decisão: `on delete cascade`, mantendo `not null`.** Justificativa:
- Preserva o fluxo issue-084 (DELETE único que confia no cascade).
- Segue `schema.md §6` e o precedente de **todas** as tabelas filhas da loja (categorias, produtos, cupons, pedidos, opcionais, pagamentos_assinatura — todas `on delete cascade`).
- LGPD: o hard-delete é apagamento de dados; remover junto as linhas de auditoria (que carregam `loja_id` + metadados do tenant) é coerente — deixar linhas órfãs apontando p/ uma loja fantasma reteria o vínculo de PII que o apagamento visa eliminar.

**Alternativas rejeitadas:**
- **RESTRICT / sem ação (como no rascunho):** bug latente — primeiro hard-delete de loja administrada lança FK violation. Rejeitada.
- **`on delete set null` + `loja_id` nullable (precedente `webhook_eventos_hotmart`):** `loja_id` é a dimensão de consulta do índice `(loja_id, criado_em desc)`; nullable permitiria linhas órfãs sem loja, esvaziando o "consulta por loja". A issue quer `not null`. Rejeitada.
- **Sem FK (precedente `admin_user_id`):** manteria `loja_id` após o delete (trilha sobrevive), sem cascade/restrict — filosoficamente um audit log é append-only. Mas a issue quer FK explícita para integridade referencial ("com loja seed p/ satisfazer o FK") e a política de retenção é fora de escopo desta issue de infra. **Registrar como opção a revisitar SE o produto exigir que a trilha sobreviva ao apagamento da loja.**

**Ação:** o SQL final abaixo corrige o rascunho adicionando `on delete cascade` (única mudança). Recomenda-se ao `tdd` **adicionar** uma asserção de cascade (espelhando `pedidos_loja_id_cascade.test.ts`): deletar a loja seed via `asService` e confirmar que a linha de `admin_acessos` some, + `delete_rule = 'CASCADE'` em `information_schema.referential_constraints`. Isso deixa a decisão de FK protegida por teste.

### Confirmação 4 — Estratégia de regen de tipos (patch manual determinístico)

Mesma disciplina da spec 4: **patch manual determinístico agora; `gen types --linked` só no passo 6c de deploy, separado, sem push nesta issue.**

- **`npx supabase gen types typescript --linked`** regenera o arquivo inteiro, exige projeto linkado + rede e, com o histórico remoto dessincronizado (memória `deploy-migrations-cloud`), pode puxar drift e reordenar linhas não relacionadas → diff ruidoso e não determinístico. Não usar como passo do GREEN.
- **Patch manual** (GREEN/execute): inserir o bloco `admin_acessos` em `src/lib/database.types.ts` espelhando `webhook_eventos_hotmart:853-897`, **na posição alfabética** (chave `admin_acessos` ordena antes de `bairros_zona` etc. → primeira tabela do objeto `Tables`, para bater com a ordenação do gerador). Diferenças frente ao webhook: `loja_id` é `string` (não-nullable, pois `not null`); `admin_user_id` **não** tem FK → sem entrada em Relationships; `metadados`/`entidade_id` nullable.

Bloco a inserir (Relationships **com as duas entradas** `lojas` + `vitrine_lojas`, igual ao webhook, para que o `gen types --linked` do passo 6c produza diff zero — o PostgREST emite a relação embarcável da view sobre `lojas`):

```ts
admin_acessos: {
  Row: {
    acao: string
    admin_user_id: string
    criado_em: string
    entidade_id: string | null
    id: string
    loja_id: string
    metadados: Json | null
  }
  Insert: {
    acao: string
    admin_user_id: string
    criado_em?: string
    entidade_id?: string | null
    id?: string
    loja_id: string
    metadados?: Json | null
  }
  Update: {
    acao?: string
    admin_user_id?: string
    criado_em?: string
    entidade_id?: string | null
    id?: string
    loja_id?: string
    metadados?: Json | null
  }
  Relationships: [
    {
      foreignKeyName: "admin_acessos_loja_id_fkey"
      columns: ["loja_id"]
      isOneToOne: false
      referencedRelation: "lojas"
      referencedColumns: ["id"]
    },
    {
      foreignKeyName: "admin_acessos_loja_id_fkey"
      columns: ["loja_id"]
      isOneToOne: false
      referencedRelation: "vitrine_lojas"
      referencedColumns: ["id"]
    },
  ]
}
```

Passo 6c (deploy, fora desta issue): `migration repair` se necessário → `npx supabase db push` → `npx supabase gen types typescript --linked` como **verificação** de que o patch manual == saída do cloud (diff esperado: zero). `npx supabase`, nunca pnpm.

### Cenários

**Caminho feliz (fase GREEN):**
1. `tdd` escreve `rls_admin_acessos.test.ts` e confirma **vermelho** com output real (tabela não existe → o insert `asService` falha; é o que prova o RED — os testes de negação passam por excesso de deny-all e não são o RED driver, igual `rls_lojas.test.ts`).
2. `executar` cria a migration `20260707122000_admin_acessos.sql` (SQL final abaixo).
3. Patch manual do bloco `admin_acessos` em `database.types.ts`.
4. `vitest run` verde (novo teste + suíte pglite existente reaplica todas as migrations em ordem). `next build` verde.

**Casos de borda:**
- **anon** `select`/`insert` em `admin_acessos` → 0 linhas / negado (RLS deny-all). Reconferido via `asService`.
- **authenticated (lojista dono de loja seed)** `select`/`insert` → 0 linhas / negado — não vaza PII cross-tenant.
- **service_role** `insert` (com loja seed p/ satisfazer FK) + `select` → funciona (BYPASSRLS).
- **FK sem loja:** `insert` com `loja_id` inexistente → `foreign_key_violation` (integridade referencial).
- **loja deletada:** hard-delete da loja → linhas de `admin_acessos` cascateiam (não travam o DELETE). Asserção de cascade recomendada.
- **Reaplicação de migration:** pglite reaplica todas as migrations a cada teste; a nova precisa ser idempotente-safe na ordem (é `create table` puro — ok, roda uma vez por banco efêmero).

**Tratamento de erros:** N/A a nível de app nesta issue (sem Server Action — `registrarAcessoAdmin` segue no-op até a 147). No banco, violação de FK/RLS é erro do Postgres; quando a 147 consumir a tabela, o padrão `seguranca.md §14` (mensagem genérica ao usuário, detalhe só no log do servidor via `console.error`) aplica-se lá, não aqui.

### Schema de Banco

**Tabela nova: `public.admin_acessos`** (trilha de auditoria, append-only, PII cross-tenant).

Colunas: `id uuid pk default gen_random_uuid()`, `admin_user_id uuid not null` (sem FK — id do dono do SaaS, sem semântica de cascade), `loja_id uuid not null references public.lojas(id) on delete cascade`, `acao text not null`, `entidade_id uuid`, `metadados jsonb`, `criado_em timestamptz not null default now()`.

Índice: `create index on public.admin_acessos (loja_id, criado_em desc)`.

**RLS:** `enable row level security` **sem policy** = deny-all para anon/authenticated; só `service_role` (BYPASSRLS). Toda tabela nova exige RLS — aqui o deny-all é o estado final (não há policy de SELECT/INSERT/UPDATE/DELETE por design). Não entra em `vitrine_lojas` nem em nenhuma view pública.

### SQL Final Confirmado

```sql
-- supabase/migrations/20260707122000_admin_acessos.sql
-- Trilha de auditoria das ações admin (service_role) sobre lojas de assinantes.
-- PII cross-tenant + implicação de billing (toggle de módulo pago). RLS habilitada
-- SEM policy: deny-all para anon/authenticated; só service_role (BYPASSRLS) acessa.
-- Padrão copiado de webhook_eventos_hotmart (schema_inicial:166-189).
create table public.admin_acessos (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,                                                 -- id do dono do SaaS (sem FK: sem semântica de cascade)
  loja_id       uuid not null references public.lojas(id) on delete cascade,   -- loja-alvo; cascade p/ não travar o hard delete admin (issue 084)
  acao          text not null,                                                 -- ex: 'criar_loja', 'salvar_tema', 'alternar_modulo'
  entidade_id   uuid,                                                          -- id da entidade tocada, quando houver
  metadados     jsonb,                                                         -- payload contextual (ex: { modulo, ativo, coluna })
  criado_em     timestamptz not null default now()
);

alter table public.admin_acessos enable row level security;                    -- deny-all (sem policy — igual a webhook_eventos_hotmart)

create index on public.admin_acessos (loja_id, criado_em desc);                -- consulta futura por loja, mais recentes primeiro

-- Rollback (manual, fora da migration):
--   drop table if exists public.admin_acessos;
```

**Única mudança frente ao rascunho da issue:** `loja_id ... on delete cascade` (o rascunho tinha RESTRICT implícito — ver Confirmação 3).

### Validação (zod)

N/A nesta issue — é migration + tipos, sem form nem Server Action. A validação de `acao`/`metadados` (se houver) nasce na issue 147, junto do corpo de `registrarAcessoAdmin`.

### Recálculo no Servidor

N/A — sem valor monetário nesta issue.

### Confirmação 5 — Harness de teste RLS

- Harness: `tests/helpers/pglite.ts` → `createTestDb()`. Assinaturas `asAnon(fn)`, `asUser(userId, fn, email?)`, `asService(fn)` (ver Análise do Codebase).
- Espelho negativo existente: `tests/migrations/schema_inicial.test.ts:490-557` (`webhook_eventos_hotmart é deny-all`). O `tdd` clona esse describe trocando a tabela e adaptando o seed (precisa de loja seed p/ o FK `not null`: inserir `auth.users` dono → `lojas` via `asService`, usar o `loja_id` nos inserts de `admin_acessos`).
- Anti-falso-verde a carregar: negação **nunca** aceita via "relation does not exist" (a tabela existirá no GREEN); negação = 0 linhas / rejeição, sempre reconferida via `asService`. Escrita "permitida" (service) confirmada por reconferência via `asService`.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `supabase/migrations/20260707122000_admin_acessos.sql` — SQL final acima.
- `tests/migrations/rls_admin_acessos.test.ts` — RED do `tdd` (espelha `schema_inicial.test.ts:490-557` + asserção de cascade de `pedidos_loja_id_cascade.test.ts`).

**Modificar:**
- `src/lib/database.types.ts` — inserir bloco `admin_acessos` (patch manual determinístico, posição alfabética).

**NÃO tocar:**
- `supabase/migrations/20260614000129_schema_inicial.sql` e demais migrations existentes — imutáveis (append-only).
- `src/lib/supabase/queries/adminAssinatura.ts` / `src/app/admin/assinantes/actions.ts` — o corpo de `registrarAcessoAdmin` e qualquer consumo da tabela são da issue 147.
- `references/*` — documentação é issue 148.
- Nenhuma policy de SELECT/UI de consulta — fora de escopo.

### Dependências Externas

Nenhuma nova. Toolchain existente: `@electric-sql/pglite` (testes), `npx supabase` CLI (regen/push no passo 6c — nunca pnpm). Sem novo pacote em `package.json`.

### Ordem de Implementação (issue crítica → RED-first)

1. **RED (`/tdd`):** escrever `tests/migrations/rls_admin_acessos.test.ts` e confirmar **vermelho** com output real (tabela ausente → insert `asService` falha). PARA aqui.
2. **GREEN (`/execute`):** criar a migration `20260707122000_admin_acessos.sql` (SQL final) → suíte pglite reaplica e o teste fica verde.
3. Patch manual do bloco `admin_acessos` em `src/lib/database.types.ts`.
4. `vitest run` + `next build` verdes (build pega export/tipo quebrado que tsc/vitest não pegam — memória `use-server-export-constraint`).
5. (fora desta issue, passo 6c de deploy) `migration repair` se preciso → `db push` → `gen types --linked` como verificação de diff-zero do patch manual.

Justificativa da ordem: a migration é pré-requisito de dados da 147; o RED prova a ausência antes de criar; os tipos dependem do schema existir; o build valida o consumo tipado.
