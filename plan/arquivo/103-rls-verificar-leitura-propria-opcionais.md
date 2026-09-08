## Plano Técnico

### Análise do Codebase

O que já existe e será reusado (inventário antes de propor qualquer criação):

- `tests/helpers/pglite.ts` — harness que aplica TODAS as migrations em ordem num pglite efêmero e expõe `asAnon` / `asUser(userId, fn, email?)` / `asService` (este com `BYPASSRLS`). `auth.uid()` é emulado por `request.jwt.claims->>'sub'`. **É o motor do teste — não criar harness novo.**
- `tests/migrations/rls_catalogo.test.ts` — **molde exato** a copiar: monta cenário via `asService` (bypass), usa IDs fixos (`DONO_A`, `DONO_B`, `DONO_A2`), helpers `existeId` / `nomeAtual` / `existePorNome` para reconferência via service (anti-falso-verde), e o padrão "leitura permitida = nº de linhas; negação reconferida via service que a linha EXISTE". Reusar os mesmos helpers e a mesma estrutura `garantirDonos` + `criarCenario`.
- `tests/migrations/rls_isolamento_multitenant.test.ts` — referência adicional de isolamento cross-loja (mesmo padrão).
- `supabase/migrations/20260614007500_opcionais.sql` — migration FONTE das três tabelas e das policies. **Não tocar** (a menos que o RED prove lacuna). Policies confirmadas por leitura linha-a-linha:
  - `opcionais_leitura_propria` (SELECT, linhas 119–126) — dono via `lojas.dono_id = auth.uid()`, **sem** `loja_esta_ativa` e **sem** filtro `ativo` → traz inativos.
  - `opc_cat_escrita_propria` (FOR ALL, linhas 94–107) — cobre SELECT do dono em `opcionais_categorias`.
  - `cat_prod_opc_escrita_propria` (FOR ALL, linhas 152–175) — cobre SELECT do dono em `categoria_produto_opcionais`.
- `src/lib/supabase/queries/opcionais.ts` — já existe (issues 088/089) e seu cabeçalho **já afirma** que "RLS retorna as próprias / traz também os inativos" sob role do dono. Recebe `client` por parâmetro (a página do painel passará o client autenticado). Este teste é o que **prova** essa afirmação do comentário. **Não modificar.**

O que precisa ser criado:
- `tests/migrations/rls_opcionais_leitura_propria.test.ts` — único arquivo novo. Justificativa de não-reuso: nenhum teste cobre HOJE o caminho de leitura própria do DONO nas três tabelas de opcionais sob loja inativa.

### Cenários

**Caminho Feliz (PERMITIDO):**
1. Dono A (`asUser(DONO_A, …)`) `SELECT` em `opcionais` da loja A → recebe os próprios, **incluindo `ativo=false`**.
2. Dono A `SELECT` em `opcionais_categorias` da loja A → recebe as próprias.
3. Dono A `SELECT` em `categoria_produto_opcionais` da loja A → recebe as próprias.
4. Mesma leitura (1–3) na **loja inativa de A** (conta `DONO_A2`, `ativo=false`) → ainda recebe tudo (independência de `loja_esta_ativa`).

**Casos de Borda (NEGADO / robusto):**
- **Vazamento cross-loja:** dono A `SELECT` das linhas da loja B nas três tabelas → **0 linhas**; reconferido via `asService` que a linha B **existe** (negação por policy, não por dado ausente).
- **Opcional inativo:** cenário tem ≥1 opcional `ativo=false` da loja A e da loja inativa — prova que a policy do dono não filtra por `ativo`.
- **Anon (sanity de não-regressão):** anon NÃO lê opcional inativo / categoria de loja inativa / associação de loja inativa (policies públicas dependem de `loja_esta_ativa`). Contrato público intacto.
- **service_role sanity:** lê tudo (bypass) — confirma que as linhas existem e os "0 linhas" são por RLS.

**Tratamento de Erros:** sem Server Action / mensagem ao usuário. A "falha" relevante é o teste vermelho ao rodar → dispara o Critério de Decisão. Nenhum detalhe interno vaza (no-op não toca produção).

### Schema de Banco

**Caminho esperado (no-op):** NENHUMA mudança. Tabelas, RLS habilitada (linhas 83–85) e policies já existem em `20260614007500_opcionais.sql`.

**Contingência (só se o RED não fechar verde):** `supabase/migrations/<timestamp > 20260621097000>_opcionais_leitura_propria.sql`, **aditiva**, espelhando `produtos_leitura_propria`:

```sql
create policy "opc_cat_leitura_propria"
  on public.opcionais_categorias for select
  using (
    exists (select 1 from public.lojas
            where lojas.id = opcionais_categorias.loja_id and lojas.dono_id = auth.uid())
  );

create policy "cat_prod_opc_leitura_propria"
  on public.categoria_produto_opcionais for select
  using (
    exists (select 1 from public.lojas
            where lojas.id = categoria_produto_opcionais.loja_id and lojas.dono_id = auth.uid())
  );
```

(`opcionais` já tem `opcionais_leitura_propria` — nunca precisa de policy nova.) **Proibido `service_role` ou `using(true)`.**

**RLS:** já habilitada e suficiente. Nenhuma policy nova no caminho esperado.

### Validação (zod)
Não se aplica — sem input de usuário, sem form/Server Action.

### Recálculo no Servidor (valor monetário)
Não se aplica — issue só verifica leitura; não calcula valor.

### Regra cliente ↔ servidor — mapeamento de invariante

| Invariante | Camada que garante | Status |
|-----------|--------------------|--------|
| Dono lê os próprios opcionais (3 tabelas), inclusive inativos | RLS `opcionais_leitura_propria` + `opc_cat_escrita_propria` (FOR ALL) + `cat_prod_opc_escrita_propria` (FOR ALL) | já existe; teste prova |
| Dono NÃO lê opcionais de outra loja | mesmas policies (escopo `dono_id = auth.uid()`) | já existe; teste prova |
| Loja inativa não cega o dono | caminho de ownership não usa `loja_esta_ativa` | já existe; teste prova |
| Anon não lê opcional inativo / loja inativa | RLS pública (`loja_esta_ativa` + `ativo`) | já existe; teste sanity |

Defesa 100% RLS no banco — correto para multitenant (`seguranca.md` §2). Nenhuma regra depende de `'use client'`.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `tests/migrations/rls_opcionais_leitura_propria.test.ts` — teste de isolamento RLS (RED → GREEN), espelhando `rls_catalogo.test.ts`: `DONO_A` (loja ativa), `DONO_B` (loja ativa), `DONO_A2` (loja inativa, RN-01 1 conta = 1 loja); cenário com categoria de opcional, opcional ativo e inativo, e associação categoria-produto ⋈ categoria-opcional em cada loja; helpers `existeId`/`existePorNome` reusados.

**Criar SOMENTE se o teste falhar (contingência):**
- `supabase/migrations/<ts>_opcionais_leitura_propria.sql` — policies `_leitura_propria` faltantes. Timestamp > `20260621097000`.

**NÃO tocar:**
- `supabase/migrations/20260614007500_opcionais.sql` — migration histórica já na cloud; lacuna se resolve com migration **nova**, nunca editando a antiga (`deploy migrations cloud`).
- `src/lib/supabase/queries/opcionais.ts` — fora de escopo.
- `tests/helpers/pglite.ts` — reusar como está.

### Dependências Externas
Nenhuma nova. `vitest` + `@electric-sql/pglite` já no `package.json` (usados por `tests/migrations/*`).

### Ordem de Implementação (issue crítica → RED-first obrigatório)

1. **RED (`/tdd`)** — escrever `tests/migrations/rls_opcionais_leitura_propria.test.ts` a partir do plano e da issue (não do código). Rodar `npx vitest run tests/migrations/rls_opcionais_leitura_propria.test.ts` e capturar output real.
   - **Esperado:** as policies já existem → os cenários do dono podem ficar verdes de primeira. Aceitável — é o próprio veredito da verificação. Para honrar o rito RED honestamente, o `/tdd` prova ANTES o poder de detecção do teste: roda uma vez com uma das três policies comentada localmente (ou assert invertido) e vê vermelho — depois restaura. Documentar esse "RED sintético" no comentário do arquivo (espírito do cabeçalho de `rls_catalogo.test.ts`).
2. **Critério de Decisão** (após rodar o teste real, sem mexer em policy):
   - **Todos os cenários do dono passam** → topo da issue: "policies suficientes → no-op". FIM. Pular passo 3.
   - **Algum cenário do dono falha** → passo 3.
3. **GREEN de contingência (`/execute`)** — criar a migration aditiva (só policies faltantes), reaplicar, ver verde. Atualizar topo da issue: "migration criada". `npx supabase db push` só após `migration repair` se o histórico remoto estiver dessincronizado.
4. **Verde final** — `npx vitest run tests/migrations/` inteiro (não-regressão das outras suites RLS).

### Riscos
- **Falso verde por harness:** pglite aplica migrations como superuser; sem `set local role` as policies seriam ignoradas. Mitigado pelo uso obrigatório de `asUser`/`asAnon` (helper faz `set local role` + claims) e reconferência via `asService` em toda negação.
- **Drift de migration na cloud:** se a contingência exigir migration, o histórico remoto está dessincronizado — `migration repair` antes do `db push`, e `npx supabase` (nunca `pnpm`).
- **Tentação de editar a migration 080:** proibido. Lacuna = migration nova.
