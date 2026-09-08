## Plano Técnico

### Análise do Codebase (confirmação da auditoria contra o schema real)

**Confirmado — a policy órfã existe e é uma superfície de escrita anon viva:**
- `supabase/migrations/20260614007500_opcionais.sql:207-209` — `ipo_insert_publico` é
  `for insert with check (public.item_pedido_aceita_opcionais(itens_pedido_opcionais.item_pedido_id))`.
  Sem cláusula de role → vale para `anon` e `authenticated`.
- `supabase/migrations/20260614008500_grants_roles_supabase.sql:20` — `GRANT ALL ON ALL TABLES ... TO anon, authenticated, service_role`.
  Logo anon TEM o privilégio de INSERT na tabela e CHEGA na policy (grant + RLS são camadas independentes).
- Resultado: chave anon (pública no browser) consegue inserir em `itens_pedido_opcionais`
  desde que o `item_pedido_id` pertença a um pedido `pendente` de loja ativa (janela do helper).

**Confirmado — a produção NUNCA insere por anon. Único caminho de escrita é a RPC:**
- `supabase/migrations/20260614009500_rpc_criar_pedido_idempotencia.sql:143-152` — `criar_pedido`
  insere em `itens_pedido_opcionais` na mesma transação do pedido. É a versão VIGENTE (16 args, drop do overload de 15).
- A RPC roda `security invoker`, mas o grant de execute é **só `service_role`**
  (`:161-172`: `revoke ... from public; revoke ... from anon, authenticated; grant execute ... to service_role`).
- `service_role` tem **BYPASSRLS** (modelo Supabase, confirmado no bootstrap do harness
  `tests/helpers/pglite.ts:41`). Ou seja: a RPC nunca avalia `ipo_insert_publico` — ela ignora RLS.
  **A policy não participa de nenhum caminho legítimo.**
- `src/lib/actions/pedido.ts:19,291,297` — a Server Action usa `createServiceClient` (service role,
  server-only) e chama `.rpc("criar_pedido", ...)`. Recalcula valores do banco antes (autoridade do servidor, §10).

**Confirmado — NENHUM caminho de app insere por anon na tabela:**
- `grep -rn '\.from("itens_pedido_opcionais")` em `src/` → **zero** chamadas `.insert`.
  As únicas referências são tipos gerados (`database.types.ts`, `types/supabase.ts`) e
  **leituras** aninhadas (`src/lib/supabase/queries/pedidos.ts:44,59,76` via
  `select "*, itens_pedido(*, itens_pedido_opcionais(*))"`, lido na confirmação
  `src/app/(publica)/loja/[slug]/confirmacao/page.tsx:165`). Leitura não é afetada por este drop.

**Conclusão:** `ipo_insert_publico` é defesa em profundidade removível. Drop = zero impacto no fluxo
legítimo (RPC service_role bypassa RLS) e fecha a superfície de escrita anon não usada.

### Regra cliente ↔ servidor (camada de enforcement)

| Invariante | Onde é garantida (depois do drop) |
|-----------|-----------------------------------|
| Escrita em `itens_pedido_opcionais` | **Só via RPC `criar_pedido` (service_role, BYPASSRLS).** anon/authenticated ficam deny-all em INSERT (sem policy) |
| Valor do opcional (nome/preço snapshot) | Recalculado na Server Action a partir do banco antes da RPC (`src/lib/actions/pedido.ts`, §10) — cliente ignorado |
| Leitura dos opcionais (lojista) | `ipo_leitura_lojista` (SELECT por dono via item→pedido→loja) — **intacta, não tocada** |
| Leitura anon dos opcionais | Já deny-all (nenhuma policy SELECT pública) — **intacta** |

Enforcement server-side presente e suficiente: o drop só REMOVE uma porta de escrita anon que o
servidor nunca usa. Nenhuma regra de valor/permissão fica órfã.

### Cenários

**Caminho Feliz (pós-drop):**
1. Cliente fecha pedido na vitrine → Server Action recalcula subtotal/total/opcionais do banco.
2. Action chama `criar_pedido` via service client (service_role).
3. RPC insere pedido + itens + `itens_pedido_opcionais` na mesma transação, bypassando RLS.
4. Lojista lê os opcionais do próprio pedido via `ipo_leitura_lojista` (inalterada).

**Casos de Borda:**
- anon tenta `insert into itens_pedido_opcionais` com `item_pedido_id` de pedido pendente alheio →
  **HOJE**: aceito (vulnerabilidade). **PÓS-DROP**: negado por RLS (deny-all, sem policy de INSERT).
- pedido legítimo com 0 opcionais → RPC não insere nada (`jsonb_typeof(...) = 'array'`), sem regressão.
- loja inativa → RPC aborta (`raise exception 'loja_inativa'`) antes de qualquer INSERT (inalterado).
- authenticated (lojista logado) tenta inserir opcional direto → também negado pós-drop (a policy também o cobria).

**Tratamento de Erros:** anon recebe erro genérico de RLS do PostgREST (sem detalhe de policy).
Detalhe só no log do servidor (§14). Fluxo de cliente nunca dispara este caminho (escreve via RPC).

### Schema de Banco

Nenhuma tabela/coluna nova. Mudança é **só de policy** (DROP). Tabela `itens_pedido_opcionais`
permanece com RLS habilitada e com a policy de SELECT do lojista.

**RLS resultante em `itens_pedido_opcionais`:**
- INSERT: nenhuma policy → deny-all para anon/authenticated; só service_role (BYPASSRLS) escreve.
- SELECT: `ipo_leitura_lojista` (dono) — **mantida**.
- UPDATE/DELETE: nenhuma policy (já era deny-all) — inalterado.

### Migration (ADITIVA — nunca editar a 080)

Maior timestamp atual no repo: `20260621097000_lojas_remove_delete_proprio.sql`.
Novo arquivo: **`supabase/migrations/20260621098000_ipo_remove_insert_publico.sql`**

Conteúdo (uma instrução, idempotente):
```sql
drop policy if exists "ipo_insert_publico" on public.itens_pedido_opcionais;
```
- NUNCA editar `20260614007500_opcionais.sql`.
- NUNCA `using(true)` nem cláusula `service_role` — service_role já bypassa RLS, não precisa de policy.
- O helper `item_pedido_aceita_opcionais` **permanece** (não dropar): a função em si não é a vulnerabilidade
  e poderia ter outros usos futuros; só a policy que a invocava sai. (Opcional documentar como débito menor;
  fora do escopo desta issue.)

### Validação (zod)

Não se aplica — não há form nem input novo. A validação de valor do opcional já vive na Server Action
(`src/lib/actions/pedido.ts`) e na RPC (snapshot autoritativo). Sem mudança.

### Recálculo no Servidor

Inalterado. O cliente envia `produto_id`/`quantidade`/opcionais escolhidos; a Server Action recalcula
preço/subtotal/desconto/total e os snapshots de opcional do banco antes de chamar a RPC (§10). Este drop
não altera o recálculo — apenas garante, no banco, que a única escrita possível em `itens_pedido_opcionais`
é a da RPC autoritativa.

### Plano do Teste RED (crítica: SIM — mexe em RLS)

**Onde mora:** `tests/migrations/rls_itens_pedido_opcionais_insert.test.ts` (arquivo NOVO; não misturar
com o de leitura `rls_itens_pedido_opcionais.test.ts`, que cobre SELECT da issue 108).

**Por que é RED real (não sintético):** o harness `tests/helpers/pglite.ts:59` concede `insert` em todas
as tabelas a `anon`. HOJE, com `ipo_insert_publico` viva, o anon passa pelo `with check` do helper e o
INSERT é ACEITO. O teste que afirma "anon NÃO insere" nasce **vermelho**. Após o drop, fica **verde**.

**Cenário a montar (via `asService` / BYPASSRLS, espelhando `criarCenario` do teste 108):**
- 1 dono em `auth.users` (helper `garantirDonos`).
- loja ATIVA (a janela do helper exige `loja_esta_ativa`).
- pedido com `status = 'pendente'` (exigência de `item_pedido_aceita_opcionais`).
- 1 `itens_pedido` desse pedido → captura `item_pedido_id` (o que vaza na URL de confirmação).

**Casos:**
1. **[RED→GREEN] anon NÃO insere opcional** — `t.asAnon(... insert into itens_pedido_opcionais
   (item_pedido_id, nome_snapshot, preco_snapshot, quantidade) values ($item, 'Fantasma', 99.00, 1))`.
   - HOJE: sucesso (vulnerabilidade) → asserção de falha quebra (VERMELHO).
   - PÓS-DROP: o INSERT lança erro de RLS → asserção espera rejeição (`await expect(...).rejects`).
   - Anti-falso-verde: reconferir via `asService` que **nenhuma** linha "Fantasma" foi gravada
     (negação por RLS, não por dado/constraint ausente).
2. **[não-regressão] RPC `criar_pedido` via service_role CONTINUA inserindo opcionais** —
   chamar a RPC com `p_itens` contendo `opcionais: [...]` (shape de
   `20260614009500_rpc_criar_pedido_idempotencia.sql:18-20`) sob `asService`, e reconferir via
   `asService` que as linhas de `itens_pedido_opcionais` do item criado existem (count == nº de opcionais).
   Deve passar ANTES e DEPOIS do drop (a RPC bypassa RLS). Reusar o padrão de
   `tests/migrations/rpc_criar_pedido.test.ts` para montar os args.
3. **(sanity opcional) authenticated também NÃO insere** — `t.asUser(DONO, ...)` mesmo INSERT → rejeitado pós-drop.

**Estado esperado:** caso 1 vermelho hoje, verde após o arquivo de migration `20260621098000`; casos 2/3
verdes nos dois momentos.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `supabase/migrations/20260621098000_ipo_remove_insert_publico.sql` — drop da policy.
- `tests/migrations/rls_itens_pedido_opcionais_insert.test.ts` — RED negativo de INSERT anon + não-regressão da RPC.

**Modificar:**
- `tasks/110-remover-policy-ipo-insert-publico-orfa.md` — marcar critérios conforme avança.

**NÃO tocar:**
- `supabase/migrations/20260614007500_opcionais.sql` — migration histórica imutável (a 080).
- `supabase/migrations/20260614009500_rpc_criar_pedido_idempotencia.sql` e `..._008000_...` — a RPC não usa a policy.
- `tests/migrations/rls_itens_pedido_opcionais.test.ts` — cobre SELECT (issue 108), não regredido por este drop.
- Helper `item_pedido_aceita_opcionais` — não dropar.
- `src/` — nenhuma mudança de app (nenhum caminho anon insere; leituras intactas).
- `tests/helpers/pglite.ts` — o grant de insert a anon é o que torna o RED detectável; mantém.

### Dependências Externas

Nenhuma. Só DDL Postgres/Supabase já em uso. Sem novo pacote.

### Ordem de Implementação (crítica SIM → RED antes do código)

1. **RED (`/tdd`)** — escrever `rls_itens_pedido_opcionais_insert.test.ts`; rodar e CONFIRMAR vermelho
   no caso 1 (anon consegue inserir hoje), com output real capturado. Casos 2/3 verdes.
2. **GREEN (`/execute`)** — criar a migration `20260621098000_ipo_remove_insert_publico.sql`.
   Rodar a suíte: caso 1 vira verde; 2/3 seguem verdes; suíte de pedido/opcionais inteira verde.
3. **Deploy cloud (passo 6b½)** — antes de `/verificar`:
   - `npx supabase migration list` → a `20260621098000` aparece só em **Local**.
   - autorização do user → `npx supabase db push`.
   - `npx supabase migration list` → reconfirmar a `20260621098000` em **Remote**.
   - (se histórico remoto dessincronizar: `migration repair` antes do push — débito conhecido.)

### Risco / Rollback

- **Risco:** mínimo. Drop de policy de INSERT que nenhum caminho legítimo usa (RPC bypassa RLS).
  Impacto no fluxo de pedido = **zero**.
- **Rollback:** totalmente reversível — recriar a policy idêntica numa nova migration aditiva
  (`create policy "ipo_insert_publico" on public.itens_pedido_opcionais for insert with check
  (public.item_pedido_aceita_opcionais(item_pedido_id));`). Nada de dado é perdido.
