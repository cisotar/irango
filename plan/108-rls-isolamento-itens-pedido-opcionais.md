## Plano Técnico

### Natureza da issue
Issue de **verificação de RLS multitenant** (crítica: SIM), não de construção. As policies da
tabela `itens_pedido_opcionais` JÁ EXISTEM em
`supabase/migrations/20260614007500_opcionais.sql:207-222`:

- `ipo_insert_publico` — INSERT anon via helper security definer `item_pedido_aceita_opcionais`
  (não dá SELECT ao anon; só permite anexar opcional a item de pedido `pendente` de loja ativa).
- `ipo_leitura_lojista` — SELECT só do dono, via `item_pedido → pedidos → lojas → dono_id = auth.uid()`.
- **NÃO existe nenhuma policy de SELECT para anon** → anon é deny-all em leitura desta tabela.

Diferença-chave vs. a issue 103 (`opcionais`): `itens_pedido_opcionais` **não tem policy pública**.
Logo NÃO há o "FINDING da vitrine" da 103 — aqui o isolamento cross-loja é o caso simples e direto:
**dono A vê 0 linhas dos opcionais de pedido da loja B, e anon vê 0 linhas de qualquer linha.**
O caso "loja inativa" também é mais simples: `ipo_leitura_lojista` NÃO chama `loja_esta_ativa`, então
o dono lê os opcionais de pedidos da própria loja mesmo se ela estiver inativa — não há caso de loja
inativa relevante para esta tabela e ele NÃO precisa ser montado.

Veredito esperado: **no-op de produção** (policy já cobre o invariante). O valor da issue é o teste
de isolamento com poder de detecção comprovado por RED sintético.

### Análise do Codebase — reuso (não reinventar)
- `tests/helpers/pglite.ts` — `createTestDb`, `asUser(userId, fn)`, `asAnon(fn)`, `asService(fn)`.
  Aplica todas as migrations em ordem + bootstrap Supabase (auth.uid via claims, roles anon/
  authenticated/service_role BYPASSRLS). **Reusar como está** — nenhum helper novo.
- `tests/migrations/rls_opcionais_leitura_propria.test.ts` — **template a espelhar**: padrão
  anti-falso-verde (negação reconferida via `asService`/`existeId`), IDs fixos, `criarCenario` via
  `asService`, `garantirDonos` insere em `auth.users` via superuser. Reusar a estrutura
  (`garantirDonos`, helper `existeId`, `ins`), adaptando o cenário para a cadeia de pedido.
- Migration `20260614007500_opcionais.sql` (policies alvo) e `20260614000129_schema_inicial.sql`
  (pedidos, itens_pedido, lojas) — **não tocar**.

### Arquivos a Criar / Modificar / NÃO tocar
- **Criar:** `tests/migrations/rls_itens_pedido_opcionais.test.ts` (único arquivo). Escrito pelo
  agente `tdd` na fase RED.
- **NÃO criar:** nenhuma migration. Caminho esperado é no-op. Contingência (só se um caso do dono
  falhar de verdade): migration ADITIVA `<ts > maior_atual>_ipo_leitura_lojista.sql` recriando a
  policy de SELECT do dono — NUNCA editando a 080, NUNCA service_role/`using(true)`.
- **NÃO tocar:** `supabase/migrations/*` (esquema e policies já corretos), `tests/helpers/pglite.ts`.
- `src/components/ui/` (shadcn): irrelevante para esta issue.

### Regra cliente ↔ servidor (camada de garantia)
Invariante 100% no **servidor (Postgres RLS)**. Não há código de cliente envolvido.
| Invariante | Camada |
|-----------|--------|
| Dono lê opcionais só dos próprios pedidos | RLS `ipo_leitura_lojista` (SELECT por dono_id = auth.uid() via item→pedido→loja) |
| Dono A NÃO lê opcionais de pedido da loja B | Mesma policy (USING falso para linha de B) |
| Anon NÃO lê nenhum opcional de pedido | Ausência de policy SELECT para anon = deny-all |
| Insert anon escopado a pedido pendente de loja ativa | `ipo_insert_publico` via helper definer (fora do escopo de leitura desta issue) |

### Cadeia de dados do cenário (montada via `asService`, bypass RLS)
`auth.users (donos)` → `lojas` → `pedidos` → `itens_pedido` → `itens_pedido_opcionais`.

IDs fixos sugeridos (determinístico):
- `DONO_A = "aaaaaaaa-...-aaaaaaaaaaaa"`, `DONO_B = "bbbbbbbb-...-bbbbbbbbbbbb"`.
- Duas lojas ATIVAS: `lojaA` (dono A), `lojaB` (dono B). **Não é preciso loja inativa** — a policy
  de leitura do dono não usa `loja_esta_ativa` (justificado acima).

**Colunas obrigatórias (NOT NULL sem default) de cada INSERT** — confirmadas no schema real:

1. `auth.users` (via superuser `t.db.query`, igual ao template): `id`, `email`.
2. `public.lojas`: `dono_id`, `slug` (regex `^[a-z0-9-]+$`, único), `nome`. (`ativo` default true —
   pode omitir; ambas ativas.)
3. `public.pedidos`: `loja_id`, `nome_cliente`, `subtotal`, `total`.
   Defaults que cobrem o resto: `id`, `token_acesso`, `desconto`=0, `taxa_entrega`=0,
   `status`='pendente', `criado_em`. (Não setar `status` é ok para o teste de SELECT.)
4. `public.itens_pedido`: `pedido_id`, `nome`, `preco`, `quantidade`. (`produto_id` nullable — omitir.)
5. `public.itens_pedido_opcionais`: `item_pedido_id`, `nome_snapshot`, `preco_snapshot`,
   `quantidade`. (`opcional_id` nullable — pode omitir; o snapshot já carrega nome/preço, e a policy
   não depende de `opcional_id`. Setar `opcional_id` é opcional e não muda o resultado.)

Linhas a criar:
- Loja A: 1 pedido → 1 item → 1 `itens_pedido_opcionais` (id `ipoA`).
- Loja B: 1 pedido → 1 item → 1 `itens_pedido_opcionais` (id `ipoB`).

### Cenários / Casos de teste exatos
Todas as leituras passam por `asUser`/`asAnon` (RLS aplicada); negação reconferida via `asService`.

- **[1] Caminho feliz — dono A lê o próprio:** `asUser(DONO_A)` → `select id from
  itens_pedido_opcionais where id = ipoA` → **1 linha**, `id === ipoA`.
- **[2] Reverso — dono B lê o próprio:** `asUser(DONO_B)` → `where id = ipoB` → **1 linha** (sanity de
  que a policy não é deny-all geral).
- **[3] Isolamento cross-loja — dono A NÃO lê o de B:** `asUser(DONO_A)` → `where id = ipoB` →
  **0 linhas**; anti-falso-verde: `existeId("itens_pedido_opcionais", ipoB) === true` via service.
- **[3b] Reverso — dono B NÃO lê o de A:** `asUser(DONO_B)` → `where id = ipoA` → **0 linhas**;
  `existeId(...ipoA) === true`.
- **[4] Anon NÃO lê (sem SELECT público) — linha de loja A ATIVA:** `asAnon` → `where id = ipoA` →
  **0 linhas**; `existeId(...ipoA) === true`. (Prova que a ausência de policy SELECT = deny-all, e que
  a loja estar ativa não abre leitura ao anon nesta tabela.)
- **[5] Anon NÃO lê — linha de loja B:** `asAnon` → `where id = ipoB` → **0 linhas**;
  `existeId(...ipoB) === true`.
- **[6] service_role lê ambas (bypass):** `asService` → `id = any([ipoA, ipoB])` → **2 linhas**
  (confirma que os 0-linhas acima são por RLS, não por dado ausente).

**Casos de borda cobertos:** sem login (anon, [4][5]); permissão de outra loja (cross-loja [3][3b]);
dado existente porém invisível (reconferência via service em todos os 0-linhas). Loja inativa: N/A
(justificado — policy de leitura não usa `loja_esta_ativa`). Falha de rede: N/A (teste de RLS in-memory).

**Tratamento de erros:** não aplicável — teste só assere contagem de linhas sob o role real; nenhuma
mensagem ao usuário envolvida.

### Plano do RED sintético (poder de detecção)
O teste nasce verde (policy já existe). Para provar detecção, derrubar localmente a policy de leitura
do dono logo após `createTestDb()` (snippet temporário, removido após capturar o output — NÃO entra na
suíte verde):

```
await t.db.exec(`drop policy "ipo_leitura_lojista" on public.itens_pedido_opcionais`);
```

Efeito esperado: sem a policy, `itens_pedido_opcionais` fica sem nenhuma policy SELECT → deny-all para
authenticated → o dono deixa de ler o próprio. Os casos **[1] e [2]** caem para **0 linhas** e falham
(`expected 1 to be 0`/`AssertionError`). Restaurando a policy (estado real do repo), a suíte volta
17→todos verde. Esse ciclo vermelho→verde prova que [1]/[2] dependem de fato de `ipo_leitura_lojista`,
não passam por acidente/dado ausente. Registrar o output real no cabeçalho do arquivo (como na 103).

### Validação (zod) / Recálculo no servidor / Dependências externas
Não se aplicam — issue puramente de RLS/teste. Sem schema zod, sem valor monetário recalculado
(os `*_snapshot` são dado pré-existente do cenário, não há Server Action nesta issue), sem pacote novo
(`@electric-sql/pglite` + `vitest` já no projeto).

### Ordem de Implementação (crítica → RED primeiro)
1. **Fase RED (`/tdd`):** escrever `tests/migrations/rls_itens_pedido_opcionais.test.ts` com os casos
   [1]–[6]; rodar com o `drop policy` sintético; capturar o vermelho real de [1]/[2]; remover o drop;
   confirmar verde. Parar (sem código de produção).
2. **Fase GREEN (`/execute`):** verificar suíte verde com o estado atual da migration 080 → marcar
   veredito **no-op documentado** na issue. Contingência (só se [1]/[2] falhar de verdade sem o drop):
   migration aditiva recriando `ipo_leitura_lojista`.
