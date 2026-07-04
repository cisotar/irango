# [121] Migration: coluna `whatsapp_envio_automatico` em `lojas` (+ view vitrine)

**crítica:** NÃO
**Mundo:** infra
**Depende de:** —
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Adicionar a preferência `lojas.whatsapp_envio_automatico` (boolean NOT NULL DEFAULT
true) e expô-la na view `vitrine_lojas`, para que o valor esteja disponível no painel,
no admin, no `criarPedido` e no preview client-side do checkout.

## Escopo
- [x] Nova migration `supabase/migrations/<timestamp>_lojas_whatsapp_envio_automatico.sql`:
  ```sql
  ALTER TABLE lojas
    ADD COLUMN whatsapp_envio_automatico boolean NOT NULL DEFAULT true;
  ```
- [x] Adicionar a coluna à view `vitrine_lojas` (a mesma migration): `buscarLojaPorSlug`
  lê `vitrine_lojas` (`src/lib/supabase/queries/lojas.ts:45/50`), e o checkout precisa
  do valor client-side para decidir pré-abrir a aba (RN-A5). Recriar a view incluindo
  `whatsapp_envio_automatico` sem alterar o filtro `ativo = true` nem expor colunas novas
  sensíveis. Respeitar `references/vitrine_lojas_select_only.md`.
- [x] Regenerar `src/lib/database.types.ts` (a coluna deve aparecer em `Tables<"lojas">`
  e `Tables<"vitrine_lojas">`). Patch manual determinístico — cloud ainda não recebeu push.
- [ ] `migration repair` antes de `db push` se o histórico remoto estiver dessincronizado;
  usar `npx supabase` (ver memória `deploy-migrations-cloud`).

## Fora de escopo
Qualquer UI, Server Action ou leitura no `criarPedido` — só schema/view/types.

## Reuso esperado
- Padrão de coluna boolean de `ativo`/`logo_url` (`references/schema.md §lojas`) — não inventar padrão novo.
- View `vitrine_lojas` já existente — recriar, não duplicar.

## Segurança
- Sem RLS nova: a coluna cai sob `lojas_update_proprio` (dono) e sob o escopo admin
  (`escopo.atualizarLoja`) existentes.
- A flag não é PII nem billing → expor em `vitrine_lojas` é aceitável (o `whatsapp` já é público).
- Não incluir na blocklist `CAMPOS_LOJA_SOMENTE_SERVIDOR` (é preferência, não billing).

## Critério de aceite
- [ ] `db push` aplica a coluna; lojas existentes ficam com `true` (default).
- [x] `Tables<"lojas">` e `Tables<"vitrine_lojas">` expõem `whatsapp_envio_automatico: boolean`.
- [ ] `npx supabase gen types` não deixa `database.types.ts` sujo em novo diff. (verificável só após `db push` no cloud)
- [x] Suíte existente (queries/lojas) continua verde após regenerar os types. (2159 testes verdes, incl. pglite que aplica a migration)

---

## Plano técnico

### 1. Análise de impacto
- **Tipo de mudança:** aditiva pura (coluna nova opcional-por-default) — **NÃO** exige
  expand→backfill→contract. Ver §5.
- **Linhas afetadas:** todas as linhas de `lojas` em prod ganham `whatsapp_envio_automatico = true`
  via DEFAULT constante (sem table rewrite, sem backfill — Postgres >= 11 materializa o
  default constante no catálogo, `attmissingval`).
- **Quem lê a coluna (após esta migration + issues seguintes):**
  - `buscarLojaDoDono` (`src/lib/supabase/queries/lojas.ts:62`) — `lojas.select("*")`, coluna entra sozinha.
  - `buscarLojaParaPedido` / `criarPedido` (`src/lib/actions/pedido.ts`) — `select("*")` service_role, entra sozinha.
  - `buscarLojaPorSlug` e `buscarLojaPublicaPorId` (`queries/lojas.ts:28/45`) — leem a **view `vitrine_lojas`**
    (`select("*")`). **Por isso a coluna precisa entrar na view** (checkout usa o valor client-side
    para pré-abrir a aba, RN-A5).
- **Quem escreve:** `montarPatchPerfil` (allowlist) via `salvarPerfil` (lojista, `lojas_update_proprio`)
  e via `atualizarPerfilAdmin`/`escopo.atualizarLoja` (admin, escopado por `id`). **Nada disso é
  alterado nesta migration** — é só schema/view/types (issues seguintes fazem a escrita).
- **Confirmação da view:** `vitrine_lojas` é `security_invoker = false` (**definer**, não invoker —
  deliberado, §19; sem SELECT anon na base, uma view invoker retornaria zero linhas). A migration
  mantém `definer` e `where ativo = true`, iguais às recriações 001500/005000/013000.
- **Definição-base da view:** a última recriação é `20260615013000_logo_url_lojas.sql`
  (a `20260616194631_lojas_coordenadas.sql` NÃO tocou a view). Lista de colunas reproduzida
  na íntegra + `whatsapp_envio_automatico`.

### 2. Arquivo(s) `.sql`
- `supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql` (criado).
  - `ADD COLUMN IF NOT EXISTS whatsapp_envio_automatico boolean NOT NULL DEFAULT true`.
  - `DROP VIEW` + `CREATE VIEW ... security_invoker = false` com as 18 colunas anteriores + a nova.
  - `REVOKE insert/update/delete` + `GRANT select` na view recriada (reafirma o hardening
    das migrations 140000/150000; a recriação **não** reintroduz escrita porque o `GRANT ALL`
    da 008500 foi one-shot e os default privileges já são SELECT-only).
- **Sem RLS nova** (coluna cai sob `lojas_update_proprio` + escopo admin existentes).

### 3. Sequência
**Aditiva — 1 passo.** Uma única migration, um único `db push`. Sem dual-shape,
sem coreografia, sem janela de escrita dupla.

### 4. Regenerar tipos
```
npx supabase gen types typescript > src/lib/database.types.ts
```
(Nunca `pnpm supabase`; nunca `src/types/supabase.ts`.) Verificar que
`Tables<"lojas">` **e** `Tables<"vitrine_lojas">` passam a expor
`whatsapp_envio_automatico: boolean`. Commitar o diff de tipos junto com a migration.

### 5. Por que é seguro sem expand/backfill/contract
`ALTER TABLE ... ADD COLUMN ... DEFAULT <constante>` em Postgres >= 11 **não reescreve
a tabela**: o default constante é gravado no catálogo (`pg_attribute.atthasmissing` /
`attmissingval`) e lido virtualmente para as linhas antigas até a próxima escrita de cada
linha. Como o default é a constante `true`, o `NOT NULL` é satisfeito para toda linha
existente **sem backfill** e sem lock de rewrite (só um `ACCESS EXCLUSIVE` momentâneo de
catálogo). Não há leitor que quebre nem escrita concorrente perdida → coreografia
desnecessária. (Se o default fosse volátil — ex.: `gen_random_uuid()` — aí sim haveria
rewrite; não é o caso.)

### 6. Rollback (por passo — passo único)
- **Reverter:** migration inversa (bloco comentado no fim do `.sql`) — recria a view sem a
  coluna e faz `DROP COLUMN IF EXISTS whatsapp_envio_automatico`.
- **`DROP COLUMN` é irreversível quanto ao dado:** só o valor não-default que algum lojista
  tiver salvo (`false`) após o deploy se perde.
- **Janela segura:** reverter é 100% sem perda enquanto nenhum lojista tiver **desligado** o
  toggle (todas as linhas ainda em `true` = default). Assim que as issues de UI
  (`salvarPerfil` / `atualizarPerfilAdmin`) forem para prod e alguém desligar, um rollback
  perde essas preferências. Reverter, portanto, é seguro no intervalo entre esta migration
  e o deploy da UI de escrita; depois disso, tratar como perda de preferência (não de pedido).

### 7. Checklist de validação
- [x] Migration aplica sem erro (pglite aplica todas as migrations no setup da suíte — 2159 testes verdes).
- [ ] Coluna existe: `lojas.whatsapp_envio_automatico` = `true` em toda linha existente do seed.
- [ ] View `vitrine_lojas` retorna a coluna (`select whatsapp_envio_automatico from vitrine_lojas`).
- [ ] RLS/isolamento por tenant intacto: loja A não lê nem escreve `whatsapp_envio_automatico`
      da loja B (a coluna herda a RLS de linha de `lojas`; a view segue `ativo = true`, sem
      novo vazamento — nada de PII/billing exposto).
- [x] Escrita anônima na view continua barrada (`revoke i/u/d` reafirmado; guarda estática [G3] de `vitrine_lojas_select_only` verde).
- [x] `database.types.ts` atualizado (patch manual determinístico, pré-push);
      `Tables<"lojas">` e `Tables<"vitrine_lojas">` expõem `whatsapp_envio_automatico: boolean`.
      (segundo `gen types` sem diff sujo: verificável só após `db push`)
- [x] `next build` + `vitest run` (suíte completa, incl. `queries/lojas` e pglite) verdes após atualizar tipos.
- [ ] Deploy cloud: `npx supabase migration repair` **antes** de `npx supabase db push` se o
      histórico remoto estiver dessincronizado (memória `deploy-migrations-cloud`).

### 8. Riscos
- **NOT NULL sem default:** N/A — há DEFAULT constante, cobre toda linha existente.
- **Leitores durante dual-shape:** N/A — não há dual-shape (1 passo).
- **Custo/lock:** desprezível — sem table rewrite; `DROP/CREATE VIEW` é metadata (a view
  não tem dado). Lock de catálogo momentâneo.
- **Recriação da view reintroduzir escrita anônima:** mitigado pelo `revoke i/u/d` explícito
  na própria migration (defesa em profundidade sobre os default privileges já SELECT-only).
- **Exposição na vitrine:** aceitável — flag de preferência, não é PII nem billing; o
  `whatsapp` já é público. Fora da blocklist `CAMPOS_LOJA_SOMENTE_SERVIDOR`.
- **Ordenação do timestamp:** `20260704120000` é posterior à última migration
  (`20260702150000`) — aplica na ordem correta.
