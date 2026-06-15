# [003] Storage bucket `produtos` + policies

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 001
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Criar o bucket `produtos` no Supabase Storage com políticas que restringem escrita à pasta `{loja_id}/` do lojista autenticado e permitem leitura pública.

## Escopo
- [ ] Criar `supabase/migrations/0003_storage_produtos.sql`
- [ ] Criar bucket `produtos` (público para leitura)
- [ ] Policy `storage_escrita_propria` (INSERT/UPDATE/DELETE) — `bucket_id = 'produtos'` e `(storage.foldername(name))[1] IN (SELECT id::text FROM lojas WHERE dono_id = auth.uid())`
- [ ] Policy `storage_leitura_publica` (SELECT) — `bucket_id = 'produtos'`

## Fora de escopo
Lógica de upload na Server Action (016), validação de MIME (010).

## Reuso esperado
- `references/seguranca.md` §18 — DDL das policies

## Segurança
- Sem essas policies, qualquer lojista sobrescreve foto de outra loja
- Path sempre `{loja_id}/{produto_id}` — isolamento por pasta

## Critério de aceite
- [ ] Bucket `produtos` existe
- [ ] (crítica) Teste vermelho: lojista A não consegue escrever em pasta `{loja_id_B}/...`; leitura pública de qualquer objeto funciona

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** o isolamento de escrita entre lojas no Storage não existe por padrão. `storage.objects` é uma tabela com RLS própria; sem policies explícitas e com bucket `public=true`, qualquer cliente autenticado pode escrever em qualquer path (incluindo `{loja_de_outro}/foto.png`) e sobrescrever a foto de produto de outra loja. A invariante violada é **"o primeiro segmento do path (`{loja_id}/`) tem de pertencer a uma loja cujo `dono_id = auth.uid()`"**. Essa verdade vive em UM lugar: a subquery `SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()`, aplicada dentro das policies de INSERT/UPDATE/DELETE.

**Por que é "complexo" (multi-camada):** afeta o schema `storage` (não `public`), depende de uma tabela de outro schema (`public.lojas` + sua coluna `dono_id`), o controle de acesso é a própria feature (sem RLS o bucket é inseguro), e o harness de teste (pglite) **não possui o schema `storage`** — exige estratégia de teste indireta (proxy) já consolidada no projeto. É marcada `crítica` porque é uma fronteira de autorização entre tenants.

**Não há remendo aqui — é o fix de raiz.** O projeto JÁ resolveu exatamente este problema para o bucket `pix-qr` (issue 074, migration `20260614006500_storage_pix_qr.sql` + teste `tests/migrations/storage_pix_qr.test.ts`). Este plano é a **aplicação fiel do mesmo padrão maduro** ao bucket `produtos`, trocando `pix-qr` → `produtos` e os nomes das policies. Reinventar a estrutura aqui seria a violação ("não reinventar a roda"): o padrão correto já está provado em produção/teste.

### Mapa de Impacto

```
NOVO supabase/migrations/20260614010500_storage_bucket_produtos.sql
  ├── INSERT storage.buckets (id='produtos', public=true)        [bucket]
  ├── POLICY produtos_leitura_publica  → storage.objects SELECT  [anon+authenticated — leitura pública, OK p/ vitrine]
  ├── POLICY produtos_insert_propria   → storage.objects INSERT  [AUTORITATIVO — escopa por dono_id]
  ├── POLICY produtos_update_propria   → storage.objects UPDATE  [AUTORITATIVO — escopa por dono_id]
  └── POLICY produtos_delete_propria   → storage.objects DELETE  [AUTORITATIVO — escopa por dono_id]
        └── lê → public.lojas (id, dono_id)  ── fonte única de verdade do tenant
                  └── auth.uid()  ── identidade do JWT

Camada onde a invariante "só escreve na pasta da própria loja" é GARANTIDA:
  ├── (não há cliente envolvido nesta issue — só infra de banco)
  └── storage.objects RLS (INSERT/UPDATE/DELETE WITH CHECK/USING) — [ÚNICA E AUTORITATIVA]

GUARD pglite: to_regclass('storage.objects') IS NULL → RETURN (skip silencioso).
Teste real (cloud): manual via Dashboard / sync SQL.
Teste pglite (proxy): valida a SUBQUERY de isolamento, não a policy literal.
```

Quem mais toca o bucket `produtos` (fora de escopo desta issue, confirma que o contrato de path está certo): a Server Action de upload (issue 016) e a validação de MIME (issue 010). Esta migration é pré-requisito de ambas. Nenhum código de aplicação existente lê/escreve `produtos` hoje — `grep -rn "produtos" components/ lib/ app/ actions/` deve confirmar ausência de uso de Storage antes de implementar (se houver, NÃO é tocado por esta issue).

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `supabase/migrations/20260614006500_storage_pix_qr.sql` | Padrão de referência (bucket pix-qr) | **NÃO tocar** — é o template, fica como está |
| `tests/migrations/storage_pix_qr.test.ts` | Padrão de referência do teste-proxy | **NÃO tocar** — é o template do teste |
| `references/seguranca.md` §18 | DDL canônico das policies de `produtos` | NÃO tocar (já descreve `produtos`; estrutura split vem do pix-qr) |
| `tests/helpers/pglite.ts` | Harness: aplica migrations, `asUser/asAnon/asService` | NÃO tocar — já oferece tudo que o teste precisa |
| `public.lojas` (schema) | Tabela tenant com `dono_id`, `slug`, `nome` | NÃO tocar — apenas lida pela subquery |
| **`supabase/migrations/20260614010500_storage_bucket_produtos.sql`** | — | **CRIAR** |
| **`tests/migrations/storage_bucket_produtos.test.ts`** | — | **CRIAR** (fase RED) |

### Decisões de Design

**Decisão 1 — Nome das policies / estrutura INSERT vs split.**
A issue (e `seguranca.md` §18) sugere os nomes `storage_escrita_propria` (uma policy de INSERT) e `storage_leitura_publica`. O pix-qr shippado usa quatro policies separadas (`leitura_publica`, `insert_propria`, `update_propria`, `delete_propria`).
- **(a) Uma policy `storage_escrita_propria` só para INSERT** (literal da §18): mais curta, mas **não cobre UPDATE nem DELETE** — um lojista poderia sobrescrever (UPDATE) ou apagar (DELETE) objeto de outra loja, porque sem policy para essas operações elas ficam negadas por padrão para `authenticated`... porém o próprio upload de Storage do Supabase frequentemente faz `upsert` (UPDATE), o que quebraria o fluxo legítimo do dono. Incompleta.
- **(b) Quatro policies (split por operação), nomes `produtos_*`** (padrão pix-qr): cobre INSERT/UPDATE/DELETE com a mesma checagem de pasta, leitura pública isolada. UPDATE precisa de `USING` **e** `WITH CHECK` (impede mover objeto legítimo para pasta de outra loja). É exatamente o padrão já validado.
- **Escolhida: (b).** Consistência com o código existente (`storage_pix_qr_*`), cobertura completa das três operações de escrita, e a §18 explicitamente diz "UPDATE/DELETE seguem o mesmo padrão". Prefixo de nome: `produtos_*` (ex.: `produtos_insert_propria`) — espelha `storage_pix_qr_*` mas evita colisão de nome de policy em `storage.objects` (policies são globais por tabela).

**Decisão 2 — Guard pglite (bloco `DO $$ … to_regclass('storage.objects') IS NULL`).**
- **(a) Sem guard:** a migration referencia `storage.objects`/`storage.buckets` que NÃO existem no pglite → toda a suíte de testes quebra ao aplicar migrations (`createTestDb` faz `db.exec` de cada arquivo).
- **(b) Guard que detecta ausência e faz `RETURN` silencioso** (padrão pix-qr): migration é no-op no pglite, executa normalmente no cloud/local Supabase.
- **Escolhida: (b)** — idêntico ao pix-qr. Sem alternativa razoável; é o que torna a migration aplicável no harness.

**Decisão 3 — Como testar isolamento sem `storage.objects` (pglite).**
- **(a) Mockar o schema `storage` no bootstrap do pglite:** alto custo, frágil (replicar `storage.foldername`, semântica de bucket, grants), e divergiria do Supabase real — falso senso de segurança.
- **(b) Teste-proxy:** validar a SUBQUERY de isolamento (`$1 IN (SELECT id::text FROM lojas WHERE dono_id = auth.uid())`) sob `asUser(A)`, `asUser(B)`, `asAnon`, mais um teste-guard de que a migration carregou sem erro. A policy real (literal `ON storage.objects`) é verificada manualmente no cloud.
- **Escolhida: (b)** — é o padrão de `storage_pix_qr.test.ts`, cobre o invariante de autorização que importa (o segmento de path pertence ao dono?) e documenta a validação cloud. `storage.foldername(name)[1]` é simulado por `path.split("/")[0]` no teste.

### Cenários

- **Caminho feliz (escrita):** lojista A autenticado faz upload em `{lojaA_id}/{produto_id}.webp`. `(storage.foldername(name))[1]` = `lojaA_id`, que está em `SELECT id FROM lojas WHERE dono_id = auth.uid()` → INSERT permitido.
- **Caminho feliz (leitura):** anon abre a vitrine, CDN serve `produtos/{lojaA_id}/foto.webp` sem token (bucket public + `produtos_leitura_publica`).
- **Ataque cross-tenant (o teste RED):** lojista A tenta escrever/sobrescrever/apagar em `{lojaB_id}/...`. Segmento `lojaB_id` NÃO está na subquery de A → INSERT/UPDATE/DELETE negados.
- **Borda — upload anônimo:** anon tenta upload em qualquer pasta. `auth.uid()` = NULL → subquery vazia → negado em qualquer path.
- **Borda — UPDATE movendo para fora:** dono de A tenta `UPDATE` renomeando objeto de `{lojaA_id}/x` para `{lojaB_id}/x`. `USING` valida o objeto atual (pertence a A, ok) mas `WITH CHECK` valida o novo path (`lojaB_id` ∉ subquery de A) → negado. (Por isso UPDATE tem as duas cláusulas.)
- **Borda — re-execução da migration (idempotência):** `ON CONFLICT (id) DO NOTHING` no bucket + `IF NOT EXISTS (SELECT 1 FROM pg_policies …)` antes de cada `CREATE POLICY`. Migration é re-aplicável sem erro.
- **Borda — pglite (sem schema storage):** guard `to_regclass IS NULL` → `RETURN` → suíte intacta.
- **Tratamento de erro:** não há mensagem de usuário nesta issue (camada de infra). Deny de policy aparece como erro de Storage do Supabase para a Server Action de upload (issue 016), que traduzirá para mensagem genérica; o log fica no servidor.

### Contratos de Dados

**Bucket `storage.buckets`:** linha nova `(id='produtos', name='produtos', public=true)`. `public=true` porque a vitrine pública (anon, sem login) exibe a foto do produto via CDN sem token assinado — mesma razão do pix-qr.

**Policies em `storage.objects` (exatas):**

```sql
-- SELECT público
USING (bucket_id = 'produtos')

-- INSERT / DELETE
WITH CHECK / USING (
  bucket_id = 'produtos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
  )
)

-- UPDATE: a mesma expressão em USING **e** WITH CHECK
```

Nenhuma tabela de `public` muda → **nenhum `supabase gen types` necessário** (tipos do projeto não cobrem `storage`). Sem novo índice (a tabela `storage.objects` é gerenciada pelo Supabase; não adicionar índices a schema gerenciado).

### Recálculo no Servidor

Não há dinheiro nesta issue. A "autoridade" aqui é a policy RLS: o cliente envia o `name` (path) do objeto, mas o servidor (Postgres, via policy) **recalcula a autorização** a partir de `auth.uid()` + `public.lojas.dono_id` — o path enviado pelo cliente nunca é confiado isoladamente; só passa se o primeiro segmento casar com loja do dono autenticado.

### Arquivos a Criar / Modificar / NÃO tocar

**CRIAR — `supabase/migrations/20260614010500_storage_bucket_produtos.sql`:**
Clonar a estrutura de `20260614006500_storage_pix_qr.sql` substituindo:
- `'pix-qr'` → `'produtos'` (bucket id/name e em todos os `bucket_id =`)
- nomes de policy `storage_pix_qr_*` → `produtos_leitura_publica` / `produtos_insert_propria` / `produtos_update_propria` / `produtos_delete_propria`
- comentário de cabeçalho `[074]` → `[003]` e texto "pix QR / checkout" → "foto de produto / vitrine"
- bloco de rollback no rodapé atualizado para os novos nomes e `id = 'produtos'`
Manter intactos: guard `DO $$ … to_regclass`, `ON CONFLICT DO NOTHING`, os `IF NOT EXISTS (SELECT 1 FROM pg_policies …)`, e UPDATE com `USING` + `WITH CHECK`.

**CRIAR (fase RED) — `tests/migrations/storage_bucket_produtos.test.ts`:**
Clonar `tests/migrations/storage_pix_qr.test.ts` substituindo os UUIDs de seed (sufixo `…003` em vez de `…074`), slugs (`loja-a-003`/`loja-b-003`), o título do `describe` (`[003] storage produtos`) e os comentários. Os 7 casos permanecem (subquery do dono A; do dono B; anon vazio; path próprio aprovado; **ATAQUE A→pasta de B negado**; ATAQUE anon negado; guard de carga da migration).

**NÃO tocar:**
- `20260614006500_storage_pix_qr.sql` e `storage_pix_qr.test.ts` — são o template, não a feature.
- `tests/helpers/pglite.ts` — já provê `asUser/asAnon/asService` e aplica migrations em ordem; nada a mudar.
- `references/seguranca.md` — §18 já documenta `produtos`; o split de policies é decisão de implementação coberta por "UPDATE/DELETE seguem o mesmo padrão". (Se o `documentar` julgar útil, pode anotar o split — fora do escopo desta issue.)
- schema gerado de tipos — não afetado.

### Dependências Externas

Nenhuma nova. Stack já presente: `@electric-sql/pglite` (harness), `vitest`. Nenhum pacote npm, nenhuma lib madura nova.

### Ordem de Implementação

1. **(RED, via `tdd`) Criar `tests/migrations/storage_bucket_produtos.test.ts`** clonando o proxy do pix-qr. Rodar `pnpm vitest run tests/migrations/storage_bucket_produtos.test.ts` → deve **falhar** porque o teste insere lojas com slug `loja-a-003`/`loja-b-003` e os asserts dependem da migration ter sido aplicada sem erro (caso 7). Antes da migration existir, o cenário ainda passaria na subquery pura — por isso o **anti-falso-verde** é: rodar a suíte com a migration **ausente** apenas confirma que a infra de seed funciona; a falha verdadeira a observar é a do passo seguinte quando uma migration mal-escrita quebra `createTestDb`. *Justificativa de criticidade:* o valor do teste é blindar regressão do isolamento — ele tem de existir e estar verde com a migration correta, e vermelho se a subquery de isolamento for afrouxada (ex.: remover `WHERE dono_id = auth.uid()` faria os casos 5 e 6 ficarem `true` → vermelho). Garanta essa sensibilidade: o caso 5 (A em pasta de B) e 6 (anon) DEVEM virar vermelho se a condição de dono for removida.
2. **(GREEN, via `executar`) Criar a migration** `20260614010500_storage_bucket_produtos.sql`.
3. **Rodar a suíte inteira** `pnpm vitest run` — a nova migration deve aplicar como no-op no pglite (guard) e todos os testes (incl. o novo) passam.
4. **Validação cloud (manual, fase pós-merge):** aplicar o SQL no Supabase real (Dashboard SQL ou arquivo de sync, se o projeto usar `supabase/_sync_cloud_pendente.sql`), depois conferir Dashboard → Storage → `produtos` → Policies e tentar upload cross-loja por cliente autenticado.

### Checklist de Validação Pós-Implementação

- [ ] `pnpm build` sem warnings novos
- [ ] `pnpm vitest run` verde, incluindo `storage_bucket_produtos.test.ts`
- [ ] Removendo `AND (storage.foldername…)` mentalmente / na subquery do teste, casos 5 e 6 viram vermelho (prova de que o teste tem dente)
- [ ] Migration é idempotente: aplicar 2x não erra (ON CONFLICT + IF NOT EXISTS)
- [ ] Guard pglite presente e funcional (suíte não quebra ao carregar a migration)
- [ ] Cloud: lojista A recebe deny ao tentar upload/upsert/delete em `{lojaB_id}/...`
- [ ] Cloud: leitura pública (anon) de `produtos/{loja}/foto` funciona sem token
- [ ] Sem secret no arquivo; sem dado pessoal hardcoded (UUIDs de teste são fixos e fake)

---

## RED (saída FAIL)

Teste criado: `tests/migrations/storage_bucket_produtos.test.ts` (clone-proxy do
padrão `storage_pix_qr.test.ts`, sufixo de seed `003`, slugs `loja-a-003`/`loja-b-003`).

Comando: `npx vitest run tests/migrations/storage_bucket_produtos.test.ts --reporter=verbose`

```
 ✓ [1] subquery retorna ID da própria loja para dono A
 ✓ [2] subquery retorna ID da própria loja para dono B
 ✓ [3] anon (sem uid) → subquery retorna vazio (sem acesso de escrita)
 ✓ [4] path '{lojaA_id}/foto.webp' → primeiro segmento é ID de loja de A (DONO_A aprovado)
 ✓ [5] ATAQUE — DONO_A tenta escrever em path '{lojaB_id}/foto.webp' → segmento NÃO pertence a A
 ✓ [6] ATAQUE — anon tenta escrever em qualquer path → subquery vazia → negado
 × [7] ANTI-FALSO-VERDE: migration `produtos` existe e codifica o contrato de isolamento 3ms
   → Migration de storage do bucket `produtos` não encontrada
     (esperado supabase/migrations/*storage_bucket_produtos*.sql). Fase GREEN ainda não implementou.

 FAIL  tests/migrations/storage_bucket_produtos.test.ts > [7] ANTI-FALSO-VERDE ...
 Error: Migration de storage do bucket `produtos` não encontrada ...
 ❯ lerMigrationProdutos tests/migrations/storage_bucket_produtos.test.ts:39:11

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**Por que este RED é honesto (anti-falso-verde):** os casos 1–6 validam só a subquery
de isolamento sobre `public.lojas` — passariam mesmo sem a migration (falso verde).
O caso [7] é o dente: lê `supabase/migrations/*storage_bucket_produtos*.sql`, que NÃO
existe hoje → FAIL real. Ele também exige que a migration codifique o guard pglite, o
bucket `produtos` público, as 4 policies (`produtos_leitura_publica` + insert/update/
delete `_propria`) e a subquery `... WHERE dono_id = auth.uid()` ≥4× (insert + update
USING + update WITH CHECK + delete). Afrouxar o escopo de dono na fase GREEN reverte o
[7] para vermelho.

### Contrato para a fase GREEN (`executar`)

**Arquivo a criar:** `supabase/migrations/20260614010500_storage_bucket_produtos.sql`
(clone fiel de `20260614006500_storage_pix_qr.sql`).

**O teste exige que o SQL contenha:**
- `to_regclass('storage.objects')` (guard pglite — RETURN silencioso)
- `INSERT INTO storage.buckets ... 'produtos' ... true` (`ON CONFLICT (id) DO NOTHING`)
- Policy `produtos_leitura_publica` — `FOR SELECT USING (bucket_id = 'produtos')`
- Policy `produtos_insert_propria` — `FOR INSERT WITH CHECK (bucket_id='produtos' AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()))`
- Policy `produtos_update_propria` — `FOR UPDATE` com a mesma expressão em `USING` **e** `WITH CHECK`
- Policy `produtos_delete_propria` — `FOR DELETE USING (...)` com a mesma expressão
- Cada `CREATE POLICY` envolto em `IF NOT EXISTS (SELECT 1 FROM pg_policies ...)` (idempotência)

**Após GREEN:** `npx vitest run tests/migrations/storage_bucket_produtos.test.ts`
deve ficar 7/7 verde (migration aplica como no-op no pglite pelo guard).

### Validação cloud (manual, fora do escopo RED)
RLS real em `storage.objects` não roda no pglite (schema `storage` ausente). Antes do
deploy: aplicar o SQL no Supabase real e confirmar via Dashboard → Storage → produtos →
Policies que lojista A recebe deny ao tentar upload/upsert/delete em `{lojaB_id}/...` e
que a leitura pública (anon) funciona sem token.
