# [208] Plano de migration — `ordem` em `categoria_produto_opcionais`

**Spec:** `specs/opcionais-sanfona-e-ordenacao.md` (v0.2.0) §Modelos de Dados
**Issue:** `tasks/208-ordem-por-categoria-de-produto-migration-rpc-e-actions.md`
**Status:** plano. **Nenhum `.sql` foi escrito** — o teste vermelho (`tdd`) vem antes; quem
escreve os arquivos é o `executar`.

---

## 1. Análise de impacto

### Quem LÊ `categoria_produto_opcionais` hoje

| Arquivo:linha | O que seleciona | Efeito da coluna nova |
|---|---|---|
| `src/lib/supabase/queries/produtos.ts:225` (`buscarOpcionaisPorCategoria`) | `categoria_id, opcionais_categorias(...)` — lista explícita | **nenhum** (não pede `ordem`); passa a pedir só na issue **210** |
| `src/lib/supabase/queries/produtos.ts:300` (`buscarOpcionaisPorCategorias`) | idem, com `.eq("loja_id")` | **nenhum**; idem 210 |
| `src/lib/supabase/queries/opcionais.ts:66` (`buscarAssociacoesOpcional`) | `select("*")` | passa a trazer `ordem` no payload. Consumidor usa só os ids para marcar checkbox → **inerte**. Tipo é `Tables<"categoria_produto_opcionais">`, regenerado; não quebra `tsc` |

Ou seja: **nenhum leitor ativo muda de comportamento** com a Migration 1 sozinha. É o que torna
o passo seguro: a coluna nasce inerte e só ganha significado quando 210 trocar a chave de
ordenação da vitrine.

### Quem ESCREVE

| Arquivo:linha | Operação | Impacto |
|---|---|---|
| `src/lib/actions/opcional.ts:319` / `:335` (`salvarAssociacaoOpcionais`) | `delete` por `(loja_id, categoria_id)` + `insert` do conjunto | **RN-12**: com a coluna nova, todo clique de checkbox zeraria a ordem (insert sem `ordem` → `default 0`). Correção é da issue 208 (Server Action), **não** da migration |
| `src/app/admin/assinantes/actions/admin-opcionais.ts:365` / `:377` (`salvarAssociacaoOpcionaisAdmin`) | mesmo delete+insert, sob `service_role` | mesma correção RN-12 |
| RPC nova (Migration 2) | `update ... set ordem` | único escritor de `ordem` |

**Volume de linhas no cloud:** não medido (não rodo query no cloud e não leio `.env*`). Ordem de
grandeza pela natureza do dado: uma linha por par (categoria de produto × grupo de opcional) por
loja — dezenas por loja, no máximo alguns milhares no total. **`ADD COLUMN ... DEFAULT 0` é
metadata-only desde o PG 11** (default não-volátil, sem rewrite), e o backfill é um `UPDATE`
sobre a tabela inteira. Nessa escala: **sem lotes, sem `CONCURRENTLY`, sem janela de manutenção.**

---

## 2. Migration 1 — coluna + backfill + índice

`supabase/migrations/20260917120000_ordem_em_categoria_produto_opcionais.sql`

### Veredito sobre expand → backfill → contract

**Cabe numa migration só, e deve ser uma migration só.** Justificativa (não é a suposição da
issue repetida — é o teste dela):

O padrão expand→contract existe para o caso em que **leitores e escritores ativos convivem com
dois shapes** durante a transição. Aqui não há dois shapes:

- nada é renomeado, dividido, retipado ou removido — é adição pura;
- **nenhum leitor lê `ordem` ao fim desta migration** (tabela da §1: os dois leitores da vitrine
  pedem colunas explícitas e não incluem `ordem`);
- o `contract` desta feature — remover `opcionais_categorias.ordem` — está **fora de escopo** e
  vira débito D-2 no `architecture.md` §10. Não é parte desta issue nem desta migration.

O que *parece* uma fase é a dupla `add column` + `update` de backfill. Ela **não** precisa ser
partida: dentro da mesma migration as duas rodam na mesma transação (§3), e partir em duas
migrations só criaria uma janela real de empate em `ordem = 0` entre um push e o outro — seria
**menos** seguro, não mais.

### Conteúdo

```sql
-- (1) expand
alter table public.categoria_produto_opcionais
  add column if not exists ordem int not null default 0;

comment on column public.categoria_produto_opcionais.ordem is
  'Posição do grupo de opcional DENTRO desta categoria de produto (0-based). Autoridade da ordem na vitrine (RN-2/RN-10). Escrita só por public.reordenar_opcionais_da_categoria.';

-- (2) backfill NEUTRO (RN-13): reproduz exatamente a ordem que a vitrine exibe
--     hoje — opcionais_categorias.ordem, desempate por nome — particionada por
--     (loja_id, categoria_id). Idempotente por ser determinístico: reexecutar
--     recalcula os mesmos valores.
update public.categoria_produto_opcionais cpo
   set ordem = p.pos
  from (
    select cpo2.id,
           row_number() over (
             partition by cpo2.loja_id, cpo2.categoria_id
             order by oc.ordem, oc.nome, cpo2.categoria_opcional_id
           ) - 1 as pos
      from public.categoria_produto_opcionais cpo2
      join public.opcionais_categorias oc
        on oc.id = cpo2.categoria_opcional_id
       and oc.loja_id = cpo2.loja_id
  ) p
 where p.id = cpo.id
   and cpo.ordem is distinct from p.pos;

-- (3) índice que sustenta RN-2
create index if not exists categoria_produto_opcionais_loja_categoria_ordem_idx
  on public.categoria_produto_opcionais (loja_id, categoria_id, ordem);
```

Três detalhes que o `executar` **não** pode simplificar:

1. **`order by oc.ordem, oc.nome, cpo2.categoria_opcional_id`** — a spec pede `ordem, nome`. O
   terceiro critério é desempate **total**: dois grupos com mesmo `ordem` e mesmo `nome` na mesma
   loja são possíveis (não há `unique (loja_id, nome)` em `opcionais_categorias` —
   `20260614007500_opcionais.sql:30-38`). Sem ele o `row_number()` é não-determinístico e o
   teste de backfill fica flaky. Ele **não** altera o resultado nos casos que a vitrine já
   distingue.
2. **`join ... and oc.loja_id = cpo2.loja_id`** — redundante com a FK composta
   (`20260614007500_opcionais.sql:66-67`), mantido como o resto do projeto mantém: escopo
   explícito além da garantia estrutural.
3. **`and cpo.ordem is distinct from p.pos`** — torna a reexecução um no-op em linhas já
   corretas (zero linhas tocadas num replay), no espírito do `update ... where nova is null`
   idempotente.

**Particionar por `(loja_id, categoria_id)`** é o que entrega a RN-10: o mesmo grupo associado a
duas categorias de produto recebe numeração independente, porque são **linhas diferentes** em
partições diferentes.

### Grants e RLS

Nenhum. Ver §6.

### Rollback

```sql
alter table public.categoria_produto_opcionais drop column if exists ordem;
-- (o DROP COLUMN leva junto o índice (loja_id, categoria_id, ordem), que o contém)
```

- **Perda:** só a ordem manual que lojistas tiverem arrastado desde o deploy. A ordem *original*
  não se perde em nenhum momento: `opcionais_categorias.ordem` continua intacta e o backfill é
  reproduzível a partir dela.
- **Janela segura (sem perda nenhuma):** do `db push` até o primeiro arrasto de um lojista em
  produção — na prática, até a issue **209** (a UI) chegar ao ar. Enquanto 209 não existir,
  ninguém consegue escrever `ordem` pela aplicação e o rollback é 100% reversível.
- **Ordem obrigatória do rollback completo:** primeiro `drop function
  public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])` (Migration 2), **depois** o
  `drop column`. Invertido, a função fica referenciando coluna inexistente e toda reordenação
  falha em runtime. Mesma disciplina do rollback de `20260907120000`.
- **Rollback parcial preferido:** dropar só a função e deixar a coluna. Ela é inerte para todo
  leitor até a 210 — custo zero, perda zero.

---

## 3. `default 0` + backfill: o risco de corrida é real?

**Não, e não vale travar nada além do que o Postgres já trava.**

`ALTER TABLE ... ADD COLUMN` adquire **ACCESS EXCLUSIVE** na tabela e o segura **até o commit da
transação**. A migration inteira (add + update + create index) roda numa transação só. Logo:

- um `INSERT` do painel que **commitou antes** do `ALTER` é visto pelo `UPDATE` do backfill e
  recebe a posição correta;
- um `INSERT` que chega **durante** a migration **bloqueia** no lock e só executa depois do
  commit. Não existe janela em que uma linha nova escape do backfill *dentro* da migration.

Sobra o caso de fora: um `INSERT` que commita **logo depois** da migration nasce com
`ordem = 0`. Isso é inevitável e **não é um bug de migration** — é exatamente a RN-12. O único
escritor dessa tabela é `salvarAssociacaoOpcionais` (painel do lojista / hub admin), que **apaga
e reinsere o conjunto inteiro da categoria**: um lojista salvando checkbox no instante do deploy
zera toda a categoria dele, com ou sem backfill. O conserto é a RN-12 na Server Action, não um
lock a mais no SQL.

Consequências práticas:

- **Não** adicionar `lock table ... in exclusive mode` — seria redundante com o lock que o
  `ADD COLUMN` já pega e só ampliaria a superfície de timeout.
- **Não** usar `add column` nullable + `update` + `set not null` — três passos para um problema
  que `default 0` resolve num, e o `SET NOT NULL` faz um seq scan de validação a mais.
- **Sequenciamento de deploy recomendado:** aplicar a Migration 1 **antes** de a UI da 209 ir ao
  ar (é o que o corte de escopo das issues já garante), e fazer o push num horário de baixo
  tráfego do painel. Em caso de azar, o conserto é o lojista re-arrastar uma vez.

---

## 4. Índice existente `(loja_id, categoria_id)` — dropar?

`20260614007500_opcionais.sql:69` cria `create index on public.categoria_produto_opcionais
(loja_id, categoria_id)` (nome automático `categoria_produto_opcionais_loja_id_categoria_id_idx`).

**Sim, o novo o torna logicamente redundante.** `(loja_id, categoria_id, ordem)` é um
superconjunto por prefixo: todo predicado que usava o antigo (`= loja_id`, `= categoria_id`,
`in (categoria_id...)`) é servido pelo novo, com um custo marginal de índice mais largo.

**Mas NÃO dropar na Migration 1.** O motivo é o rollback, não a economia:

> `drop column ordem` **derruba junto** o índice `(loja_id, categoria_id, ordem)`, porque ele
> contém a coluna. Se a Migration 1 tivesse dropado o índice antigo, o rollback deixaria a tabela
> **sem nenhum índice** em `(loja_id, categoria_id)` — e esse é exatamente o índice que sustenta
> as duas queries da vitrine (`produtos.ts:225` e `:300`). Rollback de uma feature de painel
> viraria regressão de performance na vitrine pública, que é o caminho mais quente do produto.

**Recomendação:** manter os dois índices enquanto a coluna estiver em validação. O custo é alguns
KB numa tabela de milhares de linhas — irrelevante. Dropar o antigo vira um **terceiro passo
opcional**, depois de 209 e 210 no ar e validadas:

```sql
-- supabase/migrations/<ts>_drop_indice_redundante_cat_prod_opc.sql  (NÃO nesta issue)
drop index if exists public.categoria_produto_opcionais_loja_id_categoria_id_idx;
```

Sugestão: registrar como débito (D-3) no `architecture.md` §10, junto com o D-2 de
`opcionais_categorias.ordem`, e não abrir issue própria — os dois se resolvem no mesmo PR de
limpeza.

---

## 5. Migration 2 — RPC `reordenar_opcionais_da_categoria`

`supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql`

Espelho de `20260908120000_rpc_reordenar_categorias.sql` **já incorporando** a correção de
`20260908130000` (nasce com `cardinality()` — não repetimos o erro para depois corrigi-lo).

```sql
create or replace function public.reordenar_opcionais_da_categoria(
  p_loja_id      uuid,
  p_categoria_id uuid,
  p_ids          uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_enviadas int := coalesce(cardinality(p_ids), 0);
  v_no_par   int;
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'reordenar_opcionais_da_categoria: lista vazia';
  end if;

  -- Permutação completa do PAR (loja, categoria de produto) — não da loja.
  -- Subconjunto normalizado 0..n-1 reintroduziria o empate de `ordem` que a
  -- feature existe para eliminar.
  select count(*) into v_no_par
    from public.categoria_produto_opcionais
   where loja_id = p_loja_id
     and categoria_id = p_categoria_id;
  if v_no_par <> v_enviadas then
    raise exception 'reordenar_opcionais_da_categoria: % ids para % associacoes',
      v_enviadas, v_no_par;
  end if;

  update public.categoria_produto_opcionais cpo
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where cpo.categoria_opcional_id = e.id
     and cpo.loja_id = p_loja_id          -- escopo explícito ALÉM da RLS
     and cpo.categoria_id = p_categoria_id;
  get diagnostics v_afetadas = row_count;

  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_opcionais_da_categoria: % ids, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

revoke all on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
  to authenticated, service_role;
```

Diferenças estruturais para `reordenar_categorias`, todas deliberadas:

| | `reordenar_categorias` | `reordenar_opcionais_da_categoria` |
|---|---|---|
| escopo da permutação | a loja inteira | **o par (loja, categoria de produto)** |
| chave de casamento no `update` | `c.id = e.id` (PK) | `cpo.categoria_opcional_id = e.id` (**não** a PK da associação — o cliente ordena grupos, não linhas de junção) |
| filtro extra | `loja_id` | `loja_id` **e** `categoria_id` |

O casamento por `categoria_opcional_id` é seguro porque `unique (categoria_id,
categoria_opcional_id)` (`20260614007500_opcionais.sql:61`) garante **no máximo uma** linha por
par — o `update` nunca fica ambíguo.

**Por que a contagem + `row_count` cobre os três ataques da issue de uma vez:** id de outra loja,
id inexistente, id da própria loja mas de **outra** categoria de produto e id duplicado **todos**
produzem `v_afetadas < v_enviadas`, e a exceção derruba a transação inteira — zero escrita, nas
duas lojas. `p_categoria_id` de outra loja cai antes, no `v_no_par = 0 <> v_enviadas`.

### Rollback da Migration 2

```sql
drop function if exists public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[]);
```

Sem perda de dado (a função não guarda estado). **Janela segura: permanente.** Efeito: a Server
Action passa a falhar e a UI da 209 devolve a mensagem genérica — a `ordem` já gravada continua
valendo e a vitrine segue ordenando por ela.

---

## 6. RLS — confirmação com `arquivo:linha`

**Nenhuma política nova. Confirmado, não presumido.**

`cat_prod_opc_escrita_propria` — `supabase/migrations/20260614007500_opcionais.sql:152-175`:

- **`for all`** (`:153`) → cobre `UPDATE`, que é o que a RPC faz. A policy é **por linha, não por
  coluna**: o Postgres não tem policy escopada a coluna, então uma coluna nova cai
  automaticamente sob a policy existente. Não existe "coluna descoberta".
- **`using`** (`:154-159`): `exists (select 1 from lojas where lojas.id =
  categoria_produto_opcionais.loja_id and lojas.dono_id = auth.uid())` → seleciona quais linhas o
  `UPDATE` pode enxergar/alterar. Um lojista A não enxerga linha da loja B **mesmo com a RPC
  chamada com `p_loja_id` da B** — e é por isso que a RPC é `security invoker` e nunca `definer`.
- **`with check`** (`:160-175`): três `exists`, avaliados sobre a linha **resultante** do update.

**As duas checagens de mesma-loja das pontas continuam válidas?** Sim, e vale explicar por quê,
porque é onde um `UPDATE` difere de um `INSERT`:

| check | linhas `:165-169` (`categorias`) | linhas `:170-174` (`opcionais_categorias`) |
|---|---|---|
| o que exige | existe `categorias` com `id = cpo.categoria_id` e `loja_id = cpo.loja_id` | idem para `opcionais_categorias.categoria_opcional_id` |
| a RPC altera esses campos? | **não** — o `set` toca só `ordem` | **não** |
| continua satisfeito? | **sim**: a linha resultante tem os mesmos `categoria_id`/`loja_id` que já passaram pelo check no INSERT, e as FKs compostas (`:64-67`) garantem que a linha alvo ainda existe | **sim**, idem |

Dois pontos finos que o `auditar` deve confirmar no teste, não deduzir:

1. **Os `exists` do `with check` rodam sob a RLS do invocador** (a RPC é `security invoker`). O
   dono enxerga as próprias `categorias` e `opcionais_categorias` via as respectivas policies
   `for all` de escrita própria (`categorias_escrita_propria`, e
   `opc_cat_escrita_propria` em `20260614007500_opcionais.sql:94-107`), que incluem `SELECT`.
   **Isso vale inclusive com a loja inativa** — não dependemos de `loja_esta_ativa` aqui. Merece
   um caso de teste: lojista de loja inativa/suspensa consegue reordenar.
2. **Grants são de tabela, não de coluna.** Nenhuma migration do projeto usa `grant ... (coluna)`
   — `20260702150000_revoke_grants_residuais.sql` opera em tabela e em `alter default privileges`
   de tabela. Portanto o `UPDATE` que `authenticated` já tinha na tabela cobre a coluna nova
   sem nenhum `grant` adicional. **Não** reemitir grants na Migration 1.

`cat_prod_opc_leitura_publica` (`:144-146`) é `for select` via `loja_esta_ativa` — também por
linha, também cobre a coluna nova. É ela que deixa a vitrine (anon) ler `ordem` na issue 210.

---

## 7. `cardinality()` vs `array_length()` — por que importa aqui também

`array_length(p_ids, 1)` conta **só a primeira dimensão**; `unnest` entrega **todos** os
elementos. A discrepância é a brecha que `20260908130000` corrigiu, e ela é **igual ou pior**
nesta RPC:

Com 3 grupos associados à categoria, um payload `array[[a,b],[c,a],[b,c]]`:

- `array_length(...,1)` = **3** → passa a checagem de permutação completa (`3 = 3`);
- `unnest` entrega **6** elementos, com `ordinality` 1..6;
- o `update` casa 3 **linhas distintas** (cada id aparece duas vezes; o Postgres atualiza a linha
  uma vez, com um `pos` não-determinístico entre os dois candidatos);
- `row_count` = **3** = `v_enviadas` → a checagem final **também passa**, e a corrupção
  **commita**: `ordem` vira algo como `[0, 2, 4]` ou `[1, 3, 5]`, e qual grupo fica com qual
  valor é decidido pelo plano de execução.

Com `coalesce(cardinality(p_ids), 0)` = **6** ≠ 3 associações → `raise` antes de qualquer
escrita.

Por que o vetor é real mesmo com zod e com `revoke ... from anon`:

- o zod (`z.array(z.guid())`) rejeita array aninhado, mas ele só existe na Server Action. O
  vetor é `POST /rest/v1/rpc/reordenar_opcionais_da_categoria` direto;
- `anon` não executa (RN-7), então o atacante precisa de um JWT de lojista — ele **tem** o
  próprio. O dano fica dentro da própria loja (o `where loja_id` + RLS seguram o
  cross-tenant), mas é **integridade**: `ordem` deixa de ser a permutação 0..n-1, a vitrine passa
  a render em ordem imprevisível e o bug chega como "a sanfona embaralhou sozinha";
- `coalesce(..., 0)` também cobre `p_ids := null`, que `cardinality` devolve como `NULL` e faria
  todas as comparações virarem `NULL` (nem `raise`, nem `update` — silêncio).

**Nunca escrever a versão com `array_length` "para depois corrigir".** A Migration 2 nasce
correta; `20260908130000` fica como o registro histórico do porquê.

---

## 8. Sequência de execução e o `gen types`

`npx supabase gen types typescript` lê o **cloud**. Só faz sentido **depois** do `db push`, que é
parada dura e exige autorização explícita do usuário.

```bash
# 1. RED — outro agente, antes de qualquer SQL
npx vitest run tests/migrations          # FAIL capturado (mandato 3)

# 2. GREEN local — `executar` escreve as duas migrations, nesta ordem de timestamp:
#    20260917120000_ordem_em_categoria_produto_opcionais.sql
#    20260917121000_rpc_reordenar_opcionais_da_categoria.sql
npx vitest run tests/migrations          # verde: pglite aplica TODAS em ordem
npm test                                 # suíte inteira

# 3. PARADA DURA — pedir autorização ao usuário
npx supabase migration list              # leitura; coluna Remote VAZIA nas duas

# 4. Só após o "pode dar push":
npx supabase db push
npx supabase gen types typescript > src/lib/database.types.ts

# 5. Gate na ordem do CI
npx tsc --noEmit && npm run lint && npm test && npm run build
```

**As migrations têm que ser dois arquivos com timestamps crescentes**, nunca um só: o pglite e o
`db push` aplicam em ordem alfabética de nome, e a RPC referencia `cpo.ordem` — se a coluna não
existir ainda, a criação da função até passa (plpgsql não valida o corpo no `create`), mas a
primeira chamada estoura. Separar deixa o rollback granular da §2/§5 possível.

### O que acontece com `npx tsc --noEmit` no intervalo

Entre o `executar` terminar e o `db push` acontecer, `src/lib/database.types.ts` ainda descreve o
schema **antigo**. Nesse intervalo o `tsc` fica **vermelho**, e isso é esperado:

1. `Database["public"]["Functions"]` não tem `reordenar_opcionais_da_categoria` →
   `supabase.rpc("reordenar_opcionais_da_categoria", {...})` não compila (o nome da RPC é um tipo
   literal derivado do gerado). Atinge a Server Action do lojista **e** a variante admin;
2. `Tables<"categoria_produto_opcionais">` não tem `ordem` → qualquer leitura ou escrita tipada
   da coluna (a correção da RN-12 lê `ordem` para calcular `max(ordem) + 1`) também não compila.

Três consequências que o `/fluxo` precisa absorver:

- **O gate final (`tsc → lint → test → build`) não roda com sentido antes do push.** Rodar antes
  é confirmar o vermelho, não medir qualidade;
- **Nunca editar `src/lib/database.types.ts` à mão** para "destravar" o `tsc`, e nunca introduzir
  um `as any` / `@ts-expect-error` de conveniência. Um tipo escrito à mão que diverge do cloud é
  pior que o vermelho: ele fica verde e o runtime devolve `PGRST204`;
- **`npm test` continua válido no intervalo**, porque `tests/migrations/` roda contra pglite, que
  aplica os `.sql` do repositório — não os tipos. É o único sinal confiável antes do push.

Portanto: **a autorização do `db push` é pré-requisito do fechamento da issue 208**, não um passo
de deploy posterior. `src/types/supabase.ts` permanece morto — não regenerar, não importar.

---

## 9. Checklist de validação

- [ ] `npx vitest run tests/migrations` verde (pglite aplica as duas migrations em ordem — não
      existe Supabase local)
- [ ] **Backfill (RN-13)**: categoria com 3 grupos recebe `0,1,2` na ordem
      `opcionais_categorias.ordem`; dois grupos com `ordem` empatada desempatam por `nome`; duas
      categorias de produto que compartilham um grupo recebem numeração **independente**
- [ ] **RLS cross-tenant**: lojista A chamando a RPC com `p_loja_id`/`p_categoria_id` da loja B →
      exceção e **zero linhas escritas nas duas lojas** (conferir `ordem` de A **e** de B após o
      erro)
- [ ] `asAnon` não tem `EXECUTE` na RPC
- [ ] Lista incompleta (subconjunto do par) → exceção, `ordem` intacta
- [ ] Id válido da própria loja mas de **outra** categoria de produto → exceção
- [ ] Array multidimensional (`array[[a,b],[c,a],[b,c]]`) → barrado por `cardinality()`
- [ ] Lojista de **loja inativa** consegue reordenar (os `exists` do `with check` não dependem de
      `loja_esta_ativa`)
- [ ] `npx supabase migration list` mostra as duas, `Remote` vazio até a autorização
- [ ] `src/lib/database.types.ts` regenerado **após** o push; `src/types/supabase.ts` intocado
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes **depois** do push
- [ ] `git diff` não toca `src/components/` nem `src/lib/supabase/queries/produtos.ts` (escopo
      das issues 209/210)

---

## 10. Riscos

| # | Risco | Grau | Mitigação |
|---|---|---|---|
| R1 | `not null default 0` numa tabela populada | **baixo** | default não-volátil → metadata-only no PG 11+, sem rewrite. Tabela pequena. Sem `SET NOT NULL` separado |
| R2 | Linha inserida logo após a migration nasce com `ordem = 0` e empata | **baixo** | §3: a janela *dentro* da migration não existe (ACCESS EXCLUSIVE). Fora dela é a RN-12, resolvida na Server Action. Auto-cura no próximo save ou no primeiro arrasto |
| R3 | RN-12 não implementada junto → cada clique de checkbox zera a ordem | **alto se a migration for pushada sem a action** | **A Migration 1 não pode ir ao cloud sozinha.** Push só com a correção da RN-12 (lojista **e** admin) no mesmo PR |
| R4 | `tsc` vermelho entre implementar e aplicar | **médio (processo)** | §8: é esperado; a mitigação errada (editar tipos à mão / `as any`) é o risco de verdade |
| R5 | Rollback tardio perde reordenações manuais | **baixo** | Janela segura = até 209 ir ao ar. Preferir o rollback parcial (dropar só a função) |
| R6 | Dropar o índice antigo junto → rollback deixa a vitrine sem índice | **evitado por desenho** | §4: os dois índices coexistem; o drop vira débito pós-validação |
| R7 | `row_number()` não-determinístico no backfill → teste flaky | **baixo** | terceiro critério de desempate (`categoria_opcional_id`) no `order by` |
| R8 | Escrita dupla em dois caminhos (lojista + admin) divergirem na RN-12 | **médio** | extrair o cálculo do novo conjunto para função pura compartilhada (já previsto na issue) — não duplicar a lógica |
| R9 | Custo das migrations | **desprezível** | um `ADD COLUMN` metadata-only, um `UPDATE` de milhares de linhas, um `CREATE INDEX` numa tabela pequena. Sem `CONCURRENTLY`, sem lotes |
