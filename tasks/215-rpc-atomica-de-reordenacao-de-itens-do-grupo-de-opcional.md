# [215] RPC atômica de reordenação de itens dentro do grupo de opcional

**crítica:** SIM — escrita de ordem é autorização, não CRUD. TDD red-first obrigatório.
**origem:** `plan/loop-refat-modal-de-opcionais-por-categoria.md`.
**depende de:** nada — pode rodar em paralelo com a 214. **Bloqueia a 216.**
**fecha junto:** `tasks/211-atomicidade-da-reordenacao-de-opcionais-no-admin.md`.

## Problema

`opcionais.ordem` é a ordem dos itens dentro de um grupo, e a vitrine já a respeita
(`src/lib/supabase/queries/produtos.ts`, ~linha 220). No painel, porém, ela só é gravável por
um campo numérico digitado à mão no form da Biblioteca. Não existe reordenação de itens.

Somado a isso, a reordenação **de grupos** no hub admin
(`reordenarOpcionaisDaCategoriaAdmin`, `src/app/admin/assinantes/actions/admin-opcionais.ts`)
grava com N `update` sequenciais **fora de transação** — é o débito 211. Queda de rede no 3º
de 5 deixa posições 0,1,2 gravadas e 3,4 antigas; sem unique em `(categoria_opcional_id,
ordem)` o resultado é `ordem` duplicada e vitrine não determinística.

## Escopo

Uma RPC **`security definer`** com `p_loja_id` explícito, servindo **os dois caminhos**
(lojista e hub admin), mais a action, o schema zod e o espelho admin. E a troca da
reordenação de grupos do admin pelo mesmo desenho atômico — é isso que fecha o 211.

**Por que `definer` e não `invoker`:** o admin roda sob `service_role`, onde a RLS não vale;
uma `invoker` não serve, e é exatamente por isso que o admin hoje grava à mão. Como `definer`
escapa da RLS **por construção**, o escopo deixa de ser garantido pelo banco e passa a ser
responsabilidade do corpo da função — o checklist das 7 travas de `seguranca.md` §2 é refeito
**do zero**, e `p_loja_id` é sempre provado pelo chamador (derivado de `auth.uid()` no
lojista, do escopo admin auditado na via admin), nunca aceito do payload do cliente.

**Molde estrutural:** `supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql`
— `cardinality()` (**nunca** `array_length`), permutação completa conferida por `row_count`,
`ordem` derivada de `ordinality - 1`, `revoke ... from public, anon` +
`grant execute to authenticated, service_role`. O que **não** se copia de lá é o
`security invoker`.

**Escopo da permutação (decisão do usuário):** o par `(loja_id, categoria_opcional_id)`
**inteiro**, incluindo itens com `ativo = false`. O painel enxerga os inativos e manda todos
os ids; a vitrine não renderiza os inativos e continua lendo a ordem certa (0,1,3 ordena
igual a 0,1,2). Exigir só os ativos faria o painel mandar mais ids do que a RPC espera e
derrubar a transação por `row_count`.

## Fora de escopo

Qualquer UI (216 e 217). Unique em `(categoria_opcional_id, ordem)` — não é necessário quando
a escrita é atômica e a permutação é completa.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes de qualquer linha de produção;
- [ ] migration em `supabase/migrations/` criando a RPC;
- [ ] prova em pglite (`tests/migrations/`, via `createTestDb()` de `tests/helpers/pglite.ts`)
      de que a RPC **recusa `p_loja_id` de outra loja mesmo sob `service_role`** — é a trava
      que substitui a RLS perdida com o `definer`;
- [ ] prova em pglite de **atomicidade**: falha no meio da permutação não deixa posição
      parcial gravada;
- [ ] permutação incompleta, id de outra loja, id inexistente ou duplicado → transação cai;
- [ ] action do lojista + espelho admin + schema zod (`.min(2)`), ambos apontando para a
      mesma RPC;
- [ ] `reordenarOpcionaisDaCategoriaAdmin` passa a gravar atomicamente (fecha o 211);
- [ ] `npx supabase db push` **com autorização humana explícita** (irreversível);
- [ ] depois do push: `npx supabase migration list` com `Remote` preenchida **e**
      `npx supabase gen types typescript > src/lib/database.types.ts` — a RPC precisa aparecer
      em `Database["public"]["Functions"]` ou a action não tipa;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, todos verdes.

---

## Plano técnico

> Produzido pelo agente `arquitetar` em 2026-09-18. Obrigatório neste fluxo: a saída é
> `security definer` e `tasks/211` exige passar por aqui exatamente nesse caso.
> Todas as referências de `arquivo:linha` foram conferidas no código real desta branch.

### Diagnóstico

**Causa raiz.** Existem hoje **dois modelos de autoridade** para a mesma escrita de `ordem`:
no lojista a autoridade é a RLS avaliada sob o invoker; no hub admin a RLS não existe
(`service_role` a bypassa) e a autoridade é `.eq("loja_id", lojaId)` escrito à mão na action.
Como a RPC `reordenar_opcionais_da_categoria`
(`supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql:38-40`) amarrou
a autoridade ao invoker, ela é **inutilizável** pelo admin — e o admin foi obrigado a
reimplementar a operação em JS, com N `update` sequenciais fora de transação
(`src/app/admin/assinantes/actions/admin-opcionais.ts:493-511`). O débito 211 **não é um
descuido**: é a consequência estrutural de a autoridade morar na RLS em vez de morar no corpo
da função. Enquanto ela morar lá, todo caminho `service_role` vai continuar tendo que
duplicar a operação à mão — e vai continuar não sendo atômico.

**O que isso torna obrigatório.** Mover a autoridade da RLS para **dentro do corpo** da
função (`security definer` + prova explícita de escopo) é o que faz UMA função servir os dois
chamadores. Aí a atomicidade deixa de ser um privilégio do lojista.

**Por que é complexo.**
1. Muda o modelo de segurança de uma função **já em produção** (invoker → definer), o que
   invalida texto normativo em `references/seguranca.md` §2 ("RPC de escrita em lote do
   lojista") e a linha de débito `references/architecture.md:397`.
2. Toca 4 camadas: migration/SQL, Server Action do lojista, Server Action admin, schema zod —
   e o contrato de tipos gerados (`src/lib/database.types.ts:1246-1249`).
3. Abre um **buraco no guard transversal do admin**: `enforcement-escopo-admin.test.ts:173`
   só enxerga escrita na forma `.from("t")...update|delete|insert`. Escrita admin via
   `svc.rpc(...)` — que esta issue introduz pela primeira vez — **não é vista por nenhum
   `it()`**. Sem uma camada nova, a issue fecha um débito e abre outro, invisível.
4. `security definer` remove a rede de proteção: qualquer furo no corpo vira escrita
   cross-tenant direta, sem segunda barreira.

**Remendos rejeitados explicitamente.**
- *Repetir no admin o loop de N `update`, agora para itens.* Criaria um segundo débito
  idêntico ao 211 no mesmo PR que o fecha (já rejeitado pelo usuário em D2).
- *Um `update ... from unnest(...)` cru dentro da action admin* (alternativa "mais barata"
  citada em `tasks/211`). Resolve a atomicidade e **não resolve a causa raiz**: continuariam
  dois fluxos paralelos divergentes (RPC no lojista, SQL cru no admin) que envelhecem
  separados — é o sinal de remendo "dois fluxos paralelos divergentes".
- *Guard extra em cada caminho.* A verdade da autoridade tem que ficar em UM lugar: o corpo
  da função.

### Reescopo — o que este plano acrescenta ao escopo da issue

A issue como escrita cobre itens 1-6 abaixo. O item 7 é **acréscimo do `arquitetar`**, e é
não-negociável: sem ele a issue introduz uma regressão de enforcement.

7. **CAMADA 4 do `enforcement-escopo-admin.test.ts`:** toda chamada `svc.rpc(...)` em módulo
   admin descoberto tem que passar `p_loja_id` derivado do `lojaId` validado da URL. Custo:
   ~25 linhas no arquivo de enforcement. Sem isso, a próxima action admin que escrever por RPC
   passa o CI sem nenhuma asserção de escopo.

### Mapa de Impacto

```
PAINEL DO LOJISTA (authenticated, RLS ligada)
  [216, fora desta issue] ReordenarItensDoGrupo.tsx
    └─ chama → src/lib/actions/opcional.ts :: reordenarItensDoGrupoOpcional   ← CRIAR
         ├─ parse  → src/lib/validacoes/opcional.ts :: schemaReordenacaoItensDoGrupo  ← CRIAR
         │            [cliente+servidor — forma; o .strict() impede loja_id pendurado]
         ├─ deriva → buscarLojaDoDono(supabase)            [SERVIDOR — auth.uid(); p_loja_id]
         ├─ prova  → categoriaOpcionalPertenceALoja()  (opcional.ts:43-56, REUSO)
         │            [SELECT sob RLS opcionais_leitura_propria — 20260614007500:119]
         └─ rpc    → public.reordenar_itens_do_grupo_opcional(...)            ← CRIAR
                      [AUTORITATIVO — definer; ordem = ordinality-1; row_count]
                          └─ escreve → public.opcionais.ordem (20260614007500:42-53)
                                          └─ lida por → queries/produtos.ts:238 (vitrine)
                                          └─ lida por → queries/opcionais.ts:44-55 (painel)

HUB ADMIN (service_role, RLS NÃO se aplica)
  [216/217] OpcionaisAdminClient.tsx
    └─ chama → admin-opcionais.ts :: reordenarItensDoGrupoOpcionalAdmin        ← CRIAR
         ├─ valida → validarLojaIdAdmin(lojaId)        (admin-loja.ts:30-34, REUSO)
         ├─ guard  → prepararContextoAdmin()           (admin-loja.ts:171-175, REUSO)
         │            [verificarAdminSaaS() FORA do try → propaga]
         ├─ prova  → escopo.buscarPorId("opcionais_categorias", ...) (admin-loja.ts:130-132)
         └─ rpc    → MESMA função, p_loja_id = lojaId da URL          [AUTORITATIVO]

DÉBITO 211 (grupos, mesmo PR)
  OpcionaisAdminClient.tsx:68-69
    └─ chama → admin-opcionais.ts :: reordenarOpcionaisDaCategoriaAdmin        ← MODIFICAR
         └─ HOJE: loop de N update (:493-511)  [NÃO ATÔMICO — a causa do 211]
            DEPOIS: svc.rpc("reordenar_opcionais_da_categoria", …)  [ATÔMICO]
                      └─ a MESMA função que o lojista usa (opcional.ts:427-431),
                         agora security definer com trava de autoridade no corpo

GUARD TRANSVERSAL
  enforcement-escopo-admin.test.ts:173 (ESCRITA = /\.from\(…\)\.(update|delete|insert)/)
    └─ NÃO vê svc.rpc(...)  → CAMADA 4 nova                                    ← CRIAR
```

**Assimetria cliente ↔ servidor, explícita:**

```
Sequência dos itens dentro do grupo aplicada em:
  ├── [216] lista arrastável no painel — [cliente — preview de UX, contornável]
  ├── p_ids (array de uuid)             — [ÚNICO dado que o cliente envia]
  └── reordenar_itens_do_grupo_opcional — [AUTORITATIVO: ordem = ordinality-1]

Escopo (a qual loja a escrita pode tocar):
  ├── lojista: buscarLojaDoDono(auth.uid()) → p_loja_id   [SERVIDOR, nunca do payload]
  ├── admin:   lojaId da URL + validarLojaIdAdmin + verificarAdminSaaS  [SERVIDOR]
  └── corpo da função: trava T2 (autoridade) + T3 (coerência grupo↔loja) [AUTORITATIVO]
```

Não há valor monetário nesta issue. `preco` **não** é tocado pela RPC (trava T7).

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql` | RPC de grupos, `security invoker` (:40) | **NÃO TOCAR** (migration aplicada). Substituída por `create or replace` em arquivo novo |
| `supabase/migrations/20260614007500_opcionais.sql:42-53` | tabela `opcionais` já tem `ordem int not null default 0` e índice `(loja_id, categoria_opcional_id, ativo, ordem)` | nada — **não há migration de coluna nesta issue** |
| `src/lib/validacoes/opcional.ts:58-66` | `schemaReordenacaoOpcionaisDaCategoria` | ganha irmão `schemaReordenacaoItensDoGrupo` + tipo inferido |
| `src/lib/actions/opcional.ts:396-446` | `reordenarOpcionaisDaCategoria` (lojista) | ganha irmã `reordenarItensDoGrupoOpcional`; comentário :408-409 ("`security invoker` mantém a RLS valendo") vira **falso** e tem que ser reescrito |
| `src/lib/actions/opcional.ts:43-56` | `categoriaOpcionalPertenceALoja` | **reuso puro**, zero linha nova |
| `src/app/admin/assinantes/actions/admin-opcionais.ts:445-524` | `reordenarOpcionaisDaCategoriaAdmin`, loop N-update | miolo :464-511 trocado por 1 `svc.rpc` |
| `src/app/admin/assinantes/actions/admin-opcionais.ts:68-79` | `categoriaOpcionalPertenceALoja(escopo, …)` | **reuso puro** |
| `src/lib/actions/admin-loja.ts:169` | já documenta `svc` cru para "RPC/queries" | nada — o padrão já existe |
| `src/lib/database.types.ts:1246-1249` | `Functions.reordenar_opcionais_da_categoria` | regenerado após o push; ganha `reordenar_itens_do_grupo_opcional` |
| `tests/migrations/rpc_reordenar_opcionais_da_categoria.test.ts` | 13 casos [208-R1..R11] | asserções **inalteradas** (todas seguem válidas sob definer); só os comentários :271-284 e :481 que dizem "prova `security invoker`" são reescritos |
| `src/app/admin/assinantes/actions/admin-opcionais.test.ts:57-105` | `makeChain()` sem `rpc` | ganha terminador `rpc` (molde: `src/lib/actions/opcional.test.ts:84-87`) |
| `src/app/admin/assinantes/enforcement-escopo-admin.test.ts:173` | `ESCRITA` só casa `.from().update/delete/insert` | **CAMADA 4** para `svc.rpc` |
| `references/architecture.md:397` | linha de débito do 211 | removida pelo `escriba` no fecho |
| `references/seguranca.md` §2, subseção "RPC de escrita em lote do lojista" | afirma "`SECURITY INVOKER`, nunca `DEFINER`, é carga estrutural aqui" | reescrita pelo `escriba` — vira **duas** variantes do padrão |

### Decisões de Design

#### D-A — Como o corpo da função prova a autoridade sob `definer`

Dentro de uma função `security definer`, `current_user` é o **dono** da função, não o
chamador — verificado empiricamente em pglite nesta sessão: sob `set local role authenticated`
e sob `service_role`, `current_user` = `postgres` nos dois casos. `row_security_active()`
também é inútil (retorna `false` sempre, pois avalia para o dono). Os dois sinais que
**sobrevivem** ao salto de contexto são `current_setting('role', true)` (devolveu
`authenticated` / `service_role` corretamente) e `auth.role()` (idem, lendo o claim do JWT
já verificado pelo PostgREST).

- **(a) `auth.uid() is null` ⇒ é admin.** Rejeitada: infere um privilégio da **ausência** de um
  dado. Qualquer caminho que chegue sem `sub` no claim vira admin — fail-open por construção.
- **(b) só `auth.role() = 'service_role'`.** Boa, mas depende de um sinal só.
- **(c) [ESCOLHIDA] `auth.role() = 'service_role'` E o role efetivo da sessão não ser
  `authenticated`/`anon`.** Os dois sinais nascem do **mesmo** JWT verificado pelo PostgREST
  (o claim `role` é o que decide o `SET LOCAL ROLE`), então não podem divergir em operação
  normal — e uma divergência só aconteceria num cenário de forja, onde o correto é **negar**.
  O conjunto é escrito como *"não é `authenticated` nem `anon`"*, e não como *"é igual a
  `service_role`"*, de propósito: um caminho de conexão que não faça `SET ROLE` deixa o GUC em
  `none` e **não** deve derrubar o admin. Fail-closed contra o ataque, sem falso-negativo.

#### D-B — O par (loja, grupo) tem que ser coerente, inclusive sob `service_role`

Sob `service_role` a via admin é legitimamente autorizada em **qualquer** loja — logo "recusar
`p_loja_id` de outra loja" só tem sentido como **coerência**: o `p_categoria_opcional_id` tem
que pertencer ao `p_loja_id` declarado. É essa a trava que o critério de aceite exige provar
sob `service_role`.

- **(a) Deixar a checagem implícita** (a contagem de itens do par daria 0 ≠ n → `raise`).
  Rejeitada: funciona por acidente aritmético, some se alguém mexer na ordem dos passos, e
  não é auditável como linha.
- **(b) [ESCOLHIDA] `if not exists (grupo com id = p_categoria_opcional_id and loja_id =
  p_loja_id) then raise`.** Custo: um index-scan por PK. Vira uma linha nomeável no checklist
  das 7 travas e falha cedo, antes de qualquer escrita.

#### D-C — Uma função por concern, servindo os dois caminhos (fecha o 211)

Para os **itens** a decisão do usuário já é UMA função definer servindo os dois caminhos. A
pergunta aberta era como fechar o 211 (**grupos**):

- **(a) Função nova `..._admin` `security definer`, `grant execute` só a `service_role`.**
  Prós: menor privilégio (nenhum `authenticated` alcança a definer); o caminho do lojista
  continua com a RLS como segunda rede. Contras: **mantém os dois fluxos paralelos** que são a
  causa raiz do 211; dois corpos quase idênticos que divergem com o tempo; é literalmente o
  sinal de remendo "dois fluxos paralelos divergentes".
- **(b) [ESCOLHIDA] `create or replace` da `reordenar_opcionais_da_categoria` existente para
  `security definer` + a mesma trava de autoridade, servindo lojista e admin.** Prós: ataca a
  causa raiz; simetria total com a função de itens; **uma** definição de "quem pode reordenar";
  o loop de N `update` do admin simplesmente deixa de existir. Contras: mexe numa função viva
  e remove a RLS como segunda rede no caminho do lojista.
  **Mitigação que torna (b) aceitável:** já existe uma suíte de 13 casos
  (`tests/migrations/rpc_reordenar_opcionais_da_categoria.test.ts`, [208-R1..R11]) que roda
  contra o arquivo de migration em pglite. Todas as asserções continuam válidas sob definer —
  inclusive [208-R2] (`:272`), que passa a ser garantido pela trava T2 em vez da RLS. Não se
  troca um modelo de segurança sem uma prova; aqui a prova já está escrita e é executada
  **antes** do `db push`.

#### D-D — Assinatura: `id` do opcional, não par natural

O `p_ids` são as **PKs de `public.opcionais`** (`o.id = e.id`), diferente da função de grupos,
que casa por `categoria_opcional_id` porque a PK de `categoria_produto_opcionais` não é o que
a UI manipula. Aqui a UI manipula o próprio item. Sem alternativa relevante.

#### D-E — Sem lib nova

Inventário de reuso feito antes de propor qualquer primitivo: `zod` (`opcional.ts:58-66` é o
molde literal do schema novo), `categoriaOpcionalPertenceALoja` nas duas vias
(`opcional.ts:43-56`, `admin-opcionais.ts:68-79`), `validarLojaIdAdmin` /
`prepararContextoAdmin` / `registrarAcessoAdmin` / `revalidarLojaAdmin`
(`admin-loja.ts:30,171,209,187`), `createTestDb`/`asAnon`/`asUser`/`asService`
(`tests/helpers/pglite.ts:108,149-153`), e o molde SQL de `20260917121000`. **Zero dependência
nova.** Nenhum arquivo novo em `lib/utils/` — não há lógica pura a extrair: a única regra
("a sequência vira 0..n-1") é derivada **no banco**, e duplicá-la em TS seria criar uma
segunda fonte de verdade.

### Contratos de Dados

Nenhuma coluna nova, nenhuma tabela nova, nenhum índice novo. `public.opcionais.ordem` já
existe (`20260614007500_opcionais.sql:48`) e o índice
`(loja_id, categoria_opcional_id, ativo, ordem)` (`:53`) já cobre por prefixo tanto a contagem
do par quanto o `where` do `update`. Nenhuma política RLS é criada ou alterada. **Nenhum
`supabase/seed.sql` a mexer** (por isso `popular` não entra no ciclo).

#### Migration 1 — `supabase/migrations/20260918120000_rpc_reordenar_itens_do_grupo_opcional.sql`

```sql
-- Issue 215 — RPC de reordenação dos ITENS dentro de UM grupo de opcional.
-- Fecha junto a 211 (ver 20260918121000).
--
-- Por que RPC: PostgREST não faz update-many com valor DIFERENTE POR LINHA;
-- `.upsert()` reescreveria a LINHA INTEIRA (incl. `preco`) e um id inexistente
-- inseriria item fantasma; N updates sequenciais não são atômicos.
--
-- Por que SECURITY DEFINER (e por que isso é seguro aqui): o hub admin roda sob
-- `service_role`, onde a RLS não vale — uma função `invoker` não serve, e é por
-- isso que o admin hoje grava à mão (débito 211). Sob DEFINER a RLS deixa de ser
-- a autoridade, então a autoridade é PROVADA NO CORPO (travas T2 e T3 abaixo).
-- `p_loja_id` NUNCA vem do payload do cliente: no lojista é derivado de
-- `auth.uid()` (buscarLojaDoDono), na via admin é o `lojaId` da URL já validado
-- por `validarLojaIdAdmin` + `verificarAdminSaaS`.
--
-- Escopo da permutação: o par (loja, grupo) INTEIRO, INCLUINDO `ativo = false`.
-- O painel enxerga os inativos e manda todos os ids; a vitrine não renderiza os
-- inativos e continua lendo a ordem certa (0,1,3 ordena igual a 0,1,2). Exigir
-- só os ativos faria o painel mandar mais ids do que a função espera.
--
-- Rollback: drop function if exists
--   public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[]);
-- Sem perda de dado (a função não guarda estado).

create or replace function public.reordenar_itens_do_grupo_opcional(
  p_loja_id               uuid,
  p_categoria_opcional_id uuid,
  p_ids                   uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- cardinality(), NUNCA array_length(p_ids, 1): array_length conta só a
  -- primeira dimensão enquanto o `unnest` entrega TODOS os elementos —
  -- array[[a,b],[c,a],[b,c]] passaria as checagens e gravaria `ordem` [0,2,4],
  -- quebrando a invariante 0..n-1. O coalesce cobre p_ids null.
  v_enviadas   int  := coalesce(cardinality(p_ids), 0);
  v_no_grupo   int;
  v_afetadas   int;
  -- Sinal 1: claim `role` do JWT já verificado pelo PostgREST.
  -- Sinal 2: role efetivo da sessão. `current_user` NÃO serve dentro de uma
  -- função DEFINER (vale o DONO da função, não o chamador) — verificado.
  v_role_sessao text := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico  boolean := auth.role() = 'service_role'
                          and v_role_sessao not in ('authenticated', 'anon');
begin
  -- ── T1: lista não vazia ───────────────────────────────────────────────────
  if v_enviadas = 0 then
    raise exception 'reordenar_itens_do_grupo_opcional: lista vazia';
  end if;

  -- ── T2: AUTORIDADE. É esta linha que substitui a RLS perdida com o DEFINER.
  -- Ou o chamador é o DONO da loja declarada (equivalente exato do
  -- `opcionais_escrita_propria`, 20260614007500_opcionais.sql:128), ou é a via
  -- de serviço (cujo gate é verificarAdminSaaS + lojaId validado, ANTES da
  -- chamada). Qualquer outro caso cai. Fail-closed por construção.
  if not (
       v_e_servico
    or exists (
         select 1 from public.lojas l
          where l.id = p_loja_id and l.dono_id = auth.uid()
       )
  ) then
    raise exception 'reordenar_itens_do_grupo_opcional: escopo negado';
  end if;

  -- ── T3: COERÊNCIA par (loja, grupo). Vale INCLUSIVE sob service_role: o
  -- admin pode escrever em qualquer loja, mas nunca num grupo que não é dela.
  if not exists (
    select 1 from public.opcionais_categorias oc
     where oc.id = p_categoria_opcional_id and oc.loja_id = p_loja_id
  ) then
    raise exception 'reordenar_itens_do_grupo_opcional: grupo fora da loja';
  end if;

  -- ── T4: PERMUTAÇÃO COMPLETA do par, sem filtrar por `ativo`. Normalizar um
  -- SUBCONJUNTO reintroduziria o empate de `ordem` que esta feature elimina.
  select count(*) into v_no_grupo
    from public.opcionais o
   where o.loja_id = p_loja_id
     and o.categoria_opcional_id = p_categoria_opcional_id;
  if v_no_grupo <> v_enviadas then
    raise exception 'reordenar_itens_do_grupo_opcional: % ids para % itens',
      v_enviadas, v_no_grupo;
  end if;

  -- ── T5: `ordem` DERIVADA do índice no servidor (ordinality - 1). O cliente
  -- manda só a sequência de ids — nunca valores de ordem, nunca loja_id.
  -- Escreve SÓ `ordem`: nada de `preco`, `nome`, `ativo`, `atualizado_em`.
  update public.opcionais o
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where o.id = e.id
     and o.loja_id = p_loja_id
     and o.categoria_opcional_id = p_categoria_opcional_id;
  get diagnostics v_afetadas = row_count;

  -- ── T6: id de outra loja, de outro grupo, inexistente ou duplicado → menos
  -- linhas do que ids. A exceção derruba a transação INTEIRA: escrita parcial é
  -- impossível e nada é gravado em nenhuma das lojas.
  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_itens_do_grupo_opcional: % ids, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

-- T7: o Postgres concede EXECUTE a PUBLIC por padrão em função nova e o projeto
-- NÃO tem `alter default privileges ... on functions`. Sem este revoke, anon
-- executaria a RPC direto em /rest/v1/rpc/ com a anon key do bundle público.
revoke all on function public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[])
  to authenticated, service_role;
```

#### Migration 2 — `supabase/migrations/20260918121000_rpc_reordenar_opcionais_da_categoria_definer.sql`

Fecha o **211**. `create or replace` da função de **grupos** já existente, mantendo nome,
parâmetros, tipos e retorno (`create or replace` não pode mudá-los; pode mudar
invoker→definer). Corpo idêntico ao de hoje
(`20260917121000_rpc_reordenar_opcionais_da_categoria.sql:35-100`) **mais**:

- `security definer` no lugar de `security invoker`;
- as mesmas declarações `v_role_sessao` / `v_e_servico` da migration 1;
- a trava **T2** (autoridade) antes da contagem — equivalente ao que a
  `cat_prod_opc_escrita_propria` (`20260614007500_opcionais.sql:152`) garantia sob invoker;
- a trava **T3** de coerência, aqui contra `public.categorias` (categoria de **produto**):
  `exists (select 1 from public.categorias c where c.id = p_categoria_id and c.loja_id = p_loja_id)`;
- o `revoke`/`grant` repetidos por idempotência (o `create or replace` preserva ACL, mas a
  migration não pode depender disso).

Comentário de topo obrigatório explicando que esta migration **revoga a afirmação** do
cabeçalho de `20260917121000` ("SECURITY INVOKER, nunca DEFINER") e por quê — o arquivo
antigo **não é editado**.

#### Tipos gerados

Depois do `db push`, `npx supabase gen types typescript > src/lib/database.types.ts` tem que
acrescentar em `Database["public"]["Functions"]` (hoje `src/lib/database.types.ts:1242-1249`):

```ts
reordenar_itens_do_grupo_opcional: {
  Args: { p_categoria_opcional_id: string; p_ids: string[]; p_loja_id: string }
  Returns: number
}
```

Sem isso, `supabase.rpc("reordenar_itens_do_grupo_opcional", …)` **não tipa** e
`npx tsc --noEmit` falha. É por isso que as actions são escritas **depois** do push
(ver Ordem de Implementação).

### Checklist das 7 travas — refeito do zero para função `security definer`

O checklist de `references/seguranca.md` §2 ("RPC de escrita em lote do lojista") foi escrito
para o padrão **invoker**. Sob `definer` a RLS não é avaliada, então cada garantia que ela dava
tem que ter uma **linha do corpo** que a substitui. É esta a tabela que o `auditar` tem que
conferir, item a item:

| # | Trava do padrão §2 | O que dava a garantia sob `invoker` | **Quem dá a garantia agora (`definer`)** |
|---|---|---|---|
| **T1** | Cardinalidade com `cardinality()`, nunca `array_length()` | idem | `v_enviadas := coalesce(cardinality(p_ids), 0)` + `if v_enviadas = 0 then raise`. Idêntico ao invoker — esta trava nunca dependeu da RLS. Prova: [215-I11], [215-I12] |
| **T2** | **Escopo por loja** | RLS `opcionais_escrita_propria` (`20260614007500_opcionais.sql:128`), avaliada no `update` sob o invoker: linha alheia simplesmente não era vista → `row_count` divergia | **`if not (v_e_servico or exists(select 1 from lojas l where l.id = p_loja_id and l.dono_id = auth.uid())) then raise`.** É o predicado da policy, movido para dentro da função e aplicado **antes** de qualquer leitura ou escrita. Prova: [215-I3], [215-I16] |
| **T3** | Escopo mais fino que a loja: o segundo parâmetro vem do payload e exige checagem explícita | Server Action + filtro na função + RLS (3 camadas) | Continua 3 camadas, mas a 3ª mudou de dona: (1) Server Action prova posse (`categoriaOpcionalPertenceALoja`, `opcional.ts:43-56` / `admin-opcionais.ts:68-79`); (2) **`if not exists (opcionais_categorias oc where oc.id = p_categoria_opcional_id and oc.loja_id = p_loja_id) then raise`** — vale inclusive sob `service_role`; (3) `and o.categoria_opcional_id = p_categoria_opcional_id` no `update`. Prova: [215-I4], [215-I14] |
| **T4** | Permutação **completa** conferida por contagem | contagem rodava sob a RLS de leitura do chamador | `select count(*) … where loja_id = p_loja_id and categoria_opcional_id = p_categoria_opcional_id` — agora vê tudo (definer), e por isso T2/T3 **precisam** rodar antes: é a ordem que impede a contagem de virar oráculo de existência em loja alheia. Prova: [215-I2], [215-I7] |
| **T5** | `ordem` derivada de `ordinality - 1`, nunca do cliente | idem | `set ordem = e.pos - 1 from unnest(p_ids) with ordinality`. Único statement. Prova: [215-I1], [215-I12b] |
| **T6** | `row_count` confere o efeito real (atomicidade + id alheio/duplicado) | RLS filtrava as linhas alheias → `row_count` menor | O `where` explícito (`o.loja_id` + `o.categoria_opcional_id`) filtra o que a RLS filtrava. `get diagnostics` + `raise` derrubam a transação inteira. Prova: [215-I6], [215-I8], [215-I9], [215-I10] |
| **T7** | `revoke all from public, anon` + `grant execute to authenticated, service_role` + `set search_path = public` | idem | Idêntico — **mais crítico** sob definer: um `grant` a `anon` aqui seria escrita cross-tenant com a anon key do bundle público. `set search_path = public` bloqueia hijack de resolução de nome. Prova: [215-I13] |

**Como `p_loja_id` é provado por cada chamador — nunca aceito do payload:**

| Chamador | Origem de `p_loja_id` | Prova server-side, na ordem |
|---|---|---|
| `reordenarItensDoGrupoOpcional` (lojista) | `buscarLojaDoDono(supabase).id` | schema `.strict()` (payload não tem campo `loja_id` para pendurar) → client **autenticado** (`createClient`, nunca `createServiceClient`) → `auth.uid()` resolve a loja → T2 reconfere `dono_id = auth.uid()` **dentro** da função |
| `reordenarItensDoGrupoOpcionalAdmin` (hub admin) | `lojaId` do path `/admin/assinantes/[lojaId]` | `descartarLojaId(payload)` (`admin-opcionais.ts:57-61`) → `validarLojaIdAdmin` (`admin-loja.ts:30-34`, `z.guid()`) → `prepararContextoAdmin` → `verificarAdminSaaS()` **fora do try**, antes de criar o `service_role` (`admin-loja.ts:171-175`) → `registrarAcessoAdmin` deixa rastro em `admin_acessos` → T3 reconfere a coerência loja↔grupo dentro da função |

### "Recálculo no servidor" (equivalente para `ordem`)

Não há dinheiro nesta issue, mas a regra do mandato 1 se aplica igual, porque `ordem` é
**autorização**, não CRUD:

| O cliente envia | O servidor deriva/ignora |
|---|---|
| `categoria_opcional_id` (uuid do grupo) | revalidado como da loja provada (Server Action **e** T3) |
| `opcional_id[]` (só a **sequência** de ids) | `ordem` = `ordinality - 1`, calculado no banco |
| — | `p_loja_id`: derivado de `auth.uid()` ou do `lojaId` da URL admin; **nenhum caminho aceita loja do payload** (o `.strict()` reprova, e a via admin ainda descarta antes do parse) |
| — | `preco`, `nome`, `ativo`: **a RPC não os toca** (T5 escreve uma coluna só) |

### Cenários

**Caminho feliz (lojista).** Grupo "Bordas" com 4 itens, um deles `ativo = false`. O painel
manda os 4 ids na nova sequência → T1..T4 passam → `update` afeta 4 → retorna 4 → `ordem` vira
0,1,2,3 → `revalidatePath("/painel/produtos/opcionais")` + `revalidatePath("/loja/<slug>")`.

**Caminho feliz (admin).** Mesma função, `p_loja_id` = loja-alvo da URL; `v_e_servico` é true;
T3 confere que o grupo é da loja-alvo; `registrarAcessoAdmin` grava `opcional.item.reordenar`.

**Bordas:**

| Cenário | Comportamento exigido |
|---|---|
| Item `ativo = false` omitido da lista | `raise` (T4). É a decisão D1: a permutação é do par inteiro |
| Lista com 1 id | reprovada pelo zod (`.min(2)`) antes de qualquer I/O |
| Lista com > 200 ids | reprovada pelo zod (`.max(200)`, CWE-770) |
| Id duplicado | zod `.refine` reprova; se passasse, T6 derruba |
| Id de outra loja / inexistente | `raise` (T6), zero escrita nas duas lojas |
| Grupo de outra loja | `raise` (T3), inclusive sob `service_role` |
| `p_loja_id` alheio com lojista autenticado | `raise` (T2) — o caso que a RLS cobria |
| Usuário autenticado sem loja nenhuma | `buscarLojaDoDono` devolve `null` → `{ ok: false }` antes da RPC; e T2 derrubaria de qualquer forma |
| **Loja inativa** | `ativo` da loja **não** é checado (a T2 olha `dono_id`, não `ativo`) — consistente com a função de grupos e com `opcionais_escrita_propria`, que também não olha. O paywall/estado da loja é gate de **rota** (`(bloqueavel)/layout.tsx`), não de função |
| **Race de duplo submit** (dois arrastos coalescidos) | cada chamada é um statement único e transacional; a 2ª só grava se ainda for permutação completa. O `flush` do `criarSalvamentoCoalescido` antes de outra ação já é o padrão do projeto (`architecture.md:346`) — o mecanismo vive na 216 |
| **Linha removida entre o preview e o save** (TOCTOU) | contagem e `update` estão na **mesma transação**: `v_no_grupo` diverge ou `row_count` diverge → `raise`. É o que torna o `count: "exact"` da mitigação do 211 desnecessário |
| Sessão expirada | `createClient` sem sessão → `buscarLojaDoDono` null → `{ ok: false }`; `anon` não tem EXECUTE (T7) |
| Falha do banco no meio | transação inteira cai; nenhuma posição parcial |

**Tratamento de erro.** Mensagem **única e genérica** na UI para todos os casos acima —
`ERRO_ORDEM = "Não foi possível salvar a ordem."` (`src/lib/actions/opcional.ts:34`) e
`ERRO_ORDEM_ADMIN` (`admin-opcionais.ts:48`), reusados sem criar constante nova. Mensagem
distinta por causa viraria oráculo de existência de id. O detalhe vai só para
`console.error` no servidor (`seguranca.md` §14).

### Arquivos a Criar

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/20260918120000_rpc_reordenar_itens_do_grupo_opcional.sql` | SQL literal da seção "Contratos de Dados" |
| `supabase/migrations/20260918121000_rpc_reordenar_opcionais_da_categoria_definer.sql` | `create or replace` da função de grupos: definer + T2 + T3 (contra `categorias`) + revoke/grant |
| `tests/migrations/rpc_reordenar_itens_do_grupo_opcional.test.ts` | casos [215-I1..I17] (abaixo) |
| `tests/migrations/rpc_reordenar_opcionais_da_categoria_definer.test.ts` | casos [211-G1..G5] (abaixo) |

### Arquivos a Modificar (nível função)

| Arquivo | Função / bloco | Mudança |
|---|---|---|
| `src/lib/validacoes/opcional.ts` | após `schemaReordenacaoOpcionaisDaCategoria` (:58-66) | `export const schemaReordenacaoItensDoGrupo = z.object({ categoria_opcional_id: z.guid(), opcional_id: z.array(z.guid()).min(2).max(200) }).strict().refine(ids únicos)` + `export type ReordenacaoItensDoGrupoFormData` |
| `src/lib/actions/opcional.ts` | **nova** `reordenarItensDoGrupoOpcional(payload: unknown): Promise<ResultadoOpcional>` | parse → `createClient()` → `buscarLojaDoDono` → `categoriaOpcionalPertenceALoja(supabase, categoria_opcional_id, loja.id)` → `supabase.rpc("reordenar_itens_do_grupo_opcional", { p_loja_id: loja.id, p_categoria_opcional_id: categoria_opcional_id, p_ids: opcional_id })` → `revalidatePath(CAMINHO_PAINEL)` + `revalidatePath(\`/loja/${loja.slug}\`)`. Erro → `ERRO_ORDEM` |
| `src/lib/actions/opcional.ts` | `reordenarOpcionaisDaCategoria`, comentário :408-409 | reescrever: a RLS **não** é mais a autoridade; a autoridade é a trava T2 no corpo da função. O client continua autenticado (não usar `service_role` no lojista) |
| `src/app/admin/assinantes/actions/admin-opcionais.ts` | **nova** `reordenarItensDoGrupoOpcionalAdmin(lojaId, payload)` | `validarLojaIdAdmin` → `schemaReordenacaoItensDoGrupo.safeParse(descartarLojaId(payload))` → `prepararContextoAdmin` → `categoriaOpcionalPertenceALoja(escopo, categoria_opcional_id)` → `svc.rpc("reordenar_itens_do_grupo_opcional", { p_loja_id: loja.lojaId, … })` → `registrarAcessoAdmin(svc, { lojaId, acao: "opcional.item.reordenar", entidadeId: categoria_opcional_id })` → `revalidarLojaAdmin`. Erro → `ERRO_ORDEM_ADMIN` |
| `src/app/admin/assinantes/actions/admin-opcionais.ts` | `reordenarOpcionaisDaCategoriaAdmin` (:445-524) — **fecha o 211** | **Mantém** :449-462 (validação, parse, `prepararContextoAdmin`, `categoriaProdutoPertenceALoja`). **Remove** :464-511 inteiro (SELECT de permutação + `noPar`/`cobreTudo` + loop de `update` com `count: "exact"`). **Insere** no lugar: `const { error } = await svc.rpc("reordenar_opcionais_da_categoria", { p_loja_id: loja.lojaId, p_categoria_id: categoria_id, p_ids: categoria_opcional_id }); if (error) { console.error(...); return { ok: false, erro: ERRO_ORDEM_ADMIN }; }`. **Mantém** :513-523 (log + revalidate + catch). Reescrever o docblock :430-444, que hoje afirma "NÃO reusa a RPC … ela é `security invoker`" |
| `src/lib/actions/opcional.test.ts` | novo `describe("reordenarItensDoGrupoOpcional")` | reusa o `makeChain()` de :49-88, que **já tem** terminador `rpc` |
| `src/app/admin/assinantes/actions/admin-opcionais.test.ts` | `makeChain()` (:57-105) | acrescentar terminador `rpc` no client raiz (molde literal: `src/lib/actions/opcional.test.ts:84-87`) + `chamadasRpc`/`respostaRpc` no `beforeEach` |
| `src/app/admin/assinantes/actions/admin-opcionais.test.ts` | `describe("reordenarOpcionaisDaCategoriaAdmin")` (:550-724) | reescrever os casos que asseram o loop de N `update` (:575-620) e o TOCTOU-por-`count` (:606-620) — o comportamento agora é uma chamada de RPC. **Preservar** os casos de guard (:680-724): lojaId inválido, admin negado, `loja_id` hostil descartado, erro genérico |
| `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` | **CAMADA 4 nova**, depois de :286 | para cada módulo descoberto, todo `svc.rpc("<fn>", {…})` tem que conter `p_loja_id:` seguido do identificador do lojaId validado (`loja.lojaId`/`lojaId`), nunca um campo do payload. Sanidade anti-vacuidade: ≥ 2 chamadas de RPC descobertas ao final da issue |
| `src/lib/validacoes/opcional.reordenacao.test.ts` | novo `describe` | min 2 / max 200 / `.strict()` / duplicata / guid inválido |
| `tests/migrations/rpc_reordenar_opcionais_da_categoria.test.ts` | comentários :271-284 e :481 | trocar "prova `security invoker`" por "prova a trava T2 de autoridade". **Nenhuma asserção muda** — se alguma precisar mudar, o desenho está errado: parar e reportar |

### Arquivos a NÃO tocar

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql` | migration já aplicada no cloud; editar arquivo aplicado é proibido. A troca vem por `create or replace` em arquivo novo |
| `supabase/migrations/20260614007500_opcionais.sql` | idem; `opcionais.ordem` e o índice já existem |
| `supabase/seed.sql` | nenhuma coluna/tabela nova — `popular` fora do ciclo |
| `src/lib/supabase/queries/opcionais.ts` / `produtos.ts` | leitura; a 215 é só escrita. **Ver "Riscos" nº 5**: `buscarOpcionaisDoLojista` (:44-55) ordena só por `ordem`, sem desempate — é pré-requisito da **216**, não desta issue |
| `src/components/painel/ModoReordenar.tsx`, `ReordenarOpcionaisDaCategoria.tsx`, `CartaoAssociacaoOpcionais.tsx` | UI é 216/217 |
| `OpcionaisClient.tsx`, `OpcionaisAdminClient.tsx`, `ProdutosClient.tsx`, `CardapioAdminClient.tsx` | fiação de prop de action é 216/217. A 215 **não** injeta a action nova em nenhum client — por isso `enforcement-props-action-admin.test.ts` não é tocado |
| `src/components/ui/**` | gerado pelo shadcn CLI |
| `src/types/supabase.ts` | arquivo morto (CLAUDE.md) |
| `middleware.ts`, layouts de `(painel)` | nada de auth muda |

### Dependências Externas

**Nenhuma.** Zero pacote novo em `package.json`, zero API externa, zero chave nova.

**Custo e quota (`architecture.md` §9 nº 1):** a RPC é uma chamada Postgres dentro do plano
Supabase já contratado — **não cobra por chamada** e não consome quota de API de terceiro.
O efeito no custo é **negativo** (economiza): a via admin passa de **N+1 round-trips**
(1 SELECT + N `update`, `admin-opcionais.ts:465-511`) para **1**; a via do lojista continua em
1. Não há comportamento "ao estourar" a mapear porque não há limite externo envolvido. O único
recurso consumido a mais é uma transação curta com dois index-scans por chamada (T2 em
`lojas` por PK, T3 em `opcionais_categorias` por PK) — desprezível, e numa rota autenticada de
painel, não na vitrine pública.

### Cenários de teste — fase RED (o que o `tdd` tem que escrever, um a um)

Todos em pglite via `createTestDb()` (`tests/helpers/pglite.ts:108`), com `asAnon`/`asUser`/
`asService` (:149-153). **Dois anti-falso-verde herdados do molde
`rpc_reordenar_opcionais_da_categoria.test.ts:23-34` e obrigatórios aqui:**
(a) todo caso de recusa afirma o **SQLSTATE** (`P0001` para regra de negócio, `42501` para
falta de EXECUTE) — nunca só "lançou", que passaria com `42883` enquanto a função não existe;
(b) toda releitura de "nada mudou" mora num bloco `asService` **separado**, porque `withRole`
faz `rollback` quando o callback lança (`tests/helpers/pglite.ts:141-145`) e uma asserção no
mesmo bloco passaria por causa do harness, não da função.

#### `tests/migrations/rpc_reordenar_itens_do_grupo_opcional.test.ts`

Semente: **Loja A** (dono A, ativa) com grupo *Bordas* = {i1, i2, i3 **`ativo = false`**, i4} e
grupo *Molhos* = {m1, m2}; **Loja B** (dono B, ativa) com grupo *Sucos* = {s1, s2}. Baseline
recriado a cada teste **com empate** (`ordem` = 0,0,0,0 em Bordas) — a normalização 0..n-1 é o
que existe para matá-lo. *Molhos* e *Sucos* existem para provar que nada vaza para fora do par.

| # | Caso | Esperado |
|---|---|---|
| **[215-I1]** | dono A, permutação completa de *Bordas* (4 ids, **incluindo o inativo**) | retorna 4; `ordem` = 0,1,2,3 na sequência enviada; empate morto; *Molhos* e *Sucos* **intactos** |
| **[215-I2]** | dono A omite o item `ativo = false` (3 ids para 4 itens) | `P0001`; baseline intacto. **Prova a decisão D1** — uma função que filtrasse `ativo = true` passaria em quase tudo e falharia aqui |
| **[215-I3]** | dono A passando `p_loja_id` da **loja B** + grupo *Sucos* + ids de B | `P0001`; loja B intacta. **É o caso que prova a trava T2** — sob `definer` sem T2 este `update` PASSARIA, e o dono A reescreveria a ordem da loja B só trocando o argumento |
| **[215-I4]** | **`asService`** com `p_loja_id` = loja A e `p_categoria_opcional_id` = *Sucos* (loja B) | `P0001`; nada muda nas duas lojas. **Recusa de `p_loja_id` de outra loja MESMO sob `service_role`** — trava T3, exigida pelo critério de aceite |
| **[215-I5]** | **`asService`** com `p_loja_id` = loja B e permutação completa de *Sucos* | retorna 2; grava 0,1. Prova que a via admin **funciona** em loja da qual ninguém é dono do ponto de vista do `auth.uid()` — sem isso, o 211 não fecharia |
| **[215-I6]** | **ATOMICIDADE:** criar um `before update on public.opcionais` que dá `raise` quando `new.ordem = 2`; chamar a RPC com a permutação completa de *Bordas*; `drop trigger` depois | a chamada lança; em bloco `asService` **separado**, as 4 posições estão **exatamente** no baseline (0,0,0,0). Nenhuma parcial. É a prova que o loop de N `update` do admin nunca pôde dar |
| **[215-I7]** | permutação incompleta (2 ids para 4 itens) | `P0001`; baseline intacto |
| **[215-I8]** | id de item da **loja B** dentro de `p_ids`, cardinalidade batendo (4) | `P0001`; baseline intacto nas duas lojas |
| **[215-I9]** | id **inexistente** (uuid aleatório) no lugar de um real, cardinalidade batendo | `P0001`; baseline intacto |
| **[215-I10]** | id **duplicado** (`[i1, i1, i3, i4]`) | `P0001`; baseline intacto |
| **[215-I11]** | `array[]::uuid[]` (lista vazia) | `P0001` (T1); baseline intacto |
| **[215-I12]** | array **multidimensional** `[[i1,s1],[i2,s2],[i3,s1],[i4,s2]]` | `P0001` (T1, `cardinality` conta 8 ≠ 4); e asserção explícita de que `ordem` **não** virou `[0,2,4,6]` — o sintoma exato do bug corrigido por `20260908130000` |
| **[215-I12b]** | array aninhado que **é** a permutação completa (`[[i4],[i1],[i3],[i2]]`) | grava 0,1,2,3. Contraprova: o fix é **contar**, não recusar aninhamento — sem este caso, um `array_ndims > 1 → raise` também passaria em I12 |
| **[215-I13]** | `asAnon` chamando a RPC | `42501` (T7); baseline intacto |
| **[215-I14]** | dono A com `p_loja_id` = A (sua) e grupo *Sucos* (da B) | `P0001` (T3); baseline intacto |
| **[215-I15]** | caminho feliz, e depois conferir `nome`, `preco`, `ativo`, `categoria_opcional_id`, `loja_id`, `atualizado_em` e `count(*)` de `opcionais` | **tudo inalterado** exceto `ordem`. Motivo documentado de RPC em vez de `.upsert()`: upsert reescreveria a linha inteira, incluindo `preco` |
| **[215-I16]** | `asUser(TERCEIRO)` — usuário autenticado que não é dono de loja nenhuma — com `p_loja_id` = loja A | `P0001` (T2); baseline intacto |
| **[215-I17]** | depois de [215-I1], ler como **`asAnon`** os itens ativos de *Bordas* (`order by ordem`) | vêm na sequência gravada, com `ordem` 0,1,3 (o inativo ficou com 2 e não aparece). **Prova o "0,1,3 ordena igual a 0,1,2" da decisão D1** |

#### `tests/migrations/rpc_reordenar_opcionais_da_categoria_definer.test.ts` (fecha o 211)

| # | Caso | Esperado |
|---|---|---|
| **[211-G1]** | *(não é um `it()` novo)* a suíte existente `rpc_reordenar_opcionais_da_categoria.test.ts` roda **sem alterar nenhuma asserção** | 13 casos verdes contra a função **definer**. Se algum exigir mudança de asserção, **parar e reportar** — o desenho está errado |
| **[211-G2]** | `asService` com `p_loja_id` = loja-alvo e permutação completa do par (loja, categoria de produto) | retorna n; grava 0..n-1. É o caminho que o admin passa a usar |
| **[211-G3]** | `asService` com `p_loja_id` = loja A e `p_categoria_id` = categoria de **produto** da loja B | `P0001` (T3 contra `public.categorias`); nada muda nas duas lojas |
| **[211-G4]** | dono A com `p_loja_id` da loja B (antigo [208-R2], agora sob outro mecanismo) | `P0001` **pela trava T2**, não mais pela RLS |
| **[211-G5]** | **ATOMICIDADE:** trigger `before update on public.categoria_produto_opcionais` que lança na 3ª posição; chamar a RPC com permutação completa de 5 | lança; releitura em `asService` separado mostra **zero** posição parcial. É literalmente o critério de aceite do 211 |

#### Testes de fronteira (vitest node, mocks) — RED junto

`src/lib/actions/opcional.test.ts`, novo `describe("reordenarItensDoGrupoOpcional")`:
payload lixo → nenhum I/O; `loja_id` pendurado no payload → reprovado pelo `.strict()`;
`buscarLojaDoDono` null → `{ ok:false }` sem RPC; grupo de outra loja (`opcionais_categorias`
devolve `data: null`) → `{ ok:false }` e **zero** chamada de RPC; caminho feliz → RPC chamada
uma vez com `{ p_loja_id: LOJA_DONO, p_categoria_opcional_id, p_ids }` **na ordem do payload**;
`createServiceClient` **nunca** chamado; erro da RPC → `ERRO_ORDEM` e detalhe só no
`console.error`; `revalidatePath` com `/painel/produtos/opcionais` e `/loja/<slug>` (nunca a
forma coringa `("/loja/[slug]", "page")`).

`src/app/admin/assinantes/actions/admin-opcionais.test.ts`, novo
`describe("reordenarItensDoGrupoOpcionalAdmin")`: `lojaId` não-uuid → `{ ok:false }` e
`createServiceClient` **nunca** chamado; `verificarAdminSaaS` rejeita → **propaga**, zero RPC;
`loja_id` hostil no payload → descartado, RPC recebe `p_loja_id = LOJA_ALVO`; grupo de outra
loja → `{ ok:false }` sem RPC; erro da RPC → `ERRO_ORDEM_ADMIN`; `registrarAcessoAdmin`
chamado com `acao: "opcional.item.reordenar"`.
E no `describe("reordenarOpcionaisDaCategoriaAdmin")` reescrito: **zero** `.from(...).update`
e uma `svc.rpc("reordenar_opcionais_da_categoria", { p_loja_id: LOJA_ALVO, … })`.

`src/app/admin/assinantes/enforcement-escopo-admin.test.ts`, CAMADA 4: teste de letalidade —
plantar mentalmente `svc.rpc("x", { p_loja_id: parsed.data.loja_id })` tem que fazer a camada
falhar.

### Ordem de Implementação

Estrita. A dependência é real, não estilística.

1. **`tdd` (RED).** Escrever, nesta ordem, os 4 arquivos de teste novos/alterados: as duas
   suítes pglite, o `describe` de zod, os `describe` de action e a CAMADA 4. Rodar
   `npx vitest run tests/migrations/rpc_reordenar_itens_do_grupo_opcional.test.ts` e capturar
   o **`FAIL` literal**. *Por que primeiro:* issue `crítica: SIM` — mandato 3. Sem esse `FAIL`
   no relatório, o passo 2 não começa.
2. **`migrar` (GREEN, banco).** As duas migrations. *Por que antes das actions:* as suítes
   pglite leem `supabase/migrations/*.sql` direto (`tests/helpers/pglite.ts:98-124`) e **não**
   dependem de tipos gerados nem de cloud — dá para fechar todo o vermelho de SQL sem tocar o
   Supabase. Gate: as duas suítes pglite verdes **e** a suíte 208 existente ainda verde.
3. **GATE HUMANO — `npx supabase db push`.** Irreversível; exige autorização explícita do
   usuário. *Por que aqui e não depois:* sem a função no cloud não há tipo gerado, e sem tipo
   gerado o passo 5 não compila.
4. **`npx supabase migration list`** (coluna `Remote` preenchida nas duas) **+
   `npx supabase gen types typescript > src/lib/database.types.ts`**. Conferir a olho que
   `reordenar_itens_do_grupo_opcional` apareceu em `Database["public"]["Functions"]`.
   *Por que:* pular isto é o caminho conhecido para `PGRST204` em runtime com build verde.
5. **`executar` (GREEN, TypeScript).** Nesta ordem interna: schema zod → action do lojista →
   action admin nova → troca do miolo de `reordenarOpcionaisDaCategoriaAdmin` (fecha o 211) →
   `rpc` no `makeChain()` do teste admin → CAMADA 4. *Por que o zod primeiro:* as duas actions
   o importam.
6. **Gate mecânico:** `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
   O `build` é obrigatório: dois arquivos `'use server'` são tocados, e const exportada em
   módulo `'use server'` só quebra ali.
7. **`revisar` ‖ `testar` ‖ `auditar`** em paralelo sobre o diff. O `auditar` tem uma tarefa
   nomeada: percorrer a **tabela das 7 travas** acima item a item e assinar cada linha com
   `arquivo:linha` — é o entregável que o `tasks/211` exige ("se for RPC `definer`, os 7 itens
   do checklist provados com `arquivo:linha`").
8. **`escriba`** (no fecho do PR, não por issue): reescrever `references/seguranca.md` §2
   subseção "RPC de escrita em lote do lojista" (hoje afirma "`SECURITY INVOKER`, nunca
   `DEFINER`, é carga estrutural aqui" — vira **duas** variantes do padrão, com a regra de
   quando cada uma se aplica e o checklist de substituição da RLS); remover a linha de débito
   `references/architecture.md:397`; acrescentar as duas funções a `references/schema.md`.

### Riscos e mitigação

1. **`db push` é irreversível e mexe numa função viva.** A migration 2 é `create or replace`
   sobre uma função que todo lojista usa hoje. *Mitigação:* as 13 asserções de
   `rpc_reordenar_opcionais_da_categoria.test.ts` rodam contra o **arquivo novo** em pglite
   antes do push (passo 2), e nenhuma delas pode mudar. *Rollback:* nova migration com
   `create or replace` restaurando `security invoker` — a função de grupos volta ao estado
   atual sem perda de dado; o admin voltaria ao loop. `drop function if exists
   public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[])` remove a função de itens sem
   tocar em `opcionais.ordem`.
2. **Risco alto e específico: furo na trava T2.** Sob `definer` não há segunda rede. Se T2
   ficar permissiva, qualquer lojista autenticado reescreve a ordem de qualquer loja com um
   `POST /rest/v1/rpc/`. *Mitigação:* [215-I3] e [215-I16] existem só para isso, e o `auditar`
   assina a tabela das 7 travas. **Se [215-I3] passar antes da implementação, o teste está
   errado — parar.**
3. **`auth.role()` precisa existir no cloud.** É função do schema `auth` do Supabase e está
   emulada no harness (`tests/helpers/pglite.ts:30-32`), mas nenhuma migration do repo a usa
   hoje — esta seria a primeira. *Comportamento se faltar:* `42883` em **toda** chamada, nos
   dois caminhos — falha ruidosa e fail-closed, nunca escrita indevida. *Mitigação:* o
   `verificar` exercita **os dois** caminhos (painel e hub admin) logo após o push, antes do PR.
4. **A CAMADA 4 pode nascer vacuosa.** Se a regex não casar nenhuma chamada, o teste fica
   verde sem asserir nada. *Mitigação:* sanidade anti-vacuidade (≥ 2 `svc.rpc` descobertas) e
   um teste de letalidade, no mesmo molde da sanidade que o arquivo já usa (:111-117).
5. **Fora de escopo, mas bloqueia a 216:** `buscarOpcionaisDoLojista`
   (`src/lib/supabase/queries/opcionais.ts:44-55`) ordena **só** por `ordem`, sem desempate —
   e hoje todas as linhas de `opcionais` nasceram com `ordem = 0`. É exatamente a instabilidade
   que `buscarAssociacoesOpcional` documenta e resolve em `:62-67` ("sem um segundo critério
   estável o Postgres poderia devolver ordens diferentes entre requisições — o SSR e o cliente
   divergiriam e o primeiro arrasto gravaria uma permutação que ninguém pediu"). O mesmo vale
   para o `sort` dos itens em `src/lib/supabase/queries/produtos.ts:260`, que não tem desempate
   enquanto o dos grupos tem (`compararGruposOpcionais`, `:289-292`). **Não é corrigido aqui**
   (a 215 é só escrita), mas **tem que entrar na 216** junto da lista arrastável, ou o primeiro
   arrasto grava uma permutação que o lojista não pediu.
6. **Churn de comentários obsoletos.** Quatro blocos afirmam hoje que a função de grupos é
   `invoker` por razão de segurança (`opcional.ts:408-409`, `admin-opcionais.ts:430-444`,
   `rpc_reordenar_opcionais_da_categoria.test.ts:271-284` e `:481`, `seguranca.md` §2). Comentário
   mentindo sobre o modelo de segurança é pior que comentário ausente. Todos estão listados em
   "Arquivos a Modificar" e o `revisar` deve tratar qualquer sobra como bloqueante.

### Checklist de Validação Pós-Implementação

- [ ] `FAIL` literal do `tdd` capturado **antes** de qualquer linha de produção
- [ ] as duas suítes pglite novas verdes **e** `rpc_reordenar_opcionais_da_categoria.test.ts`
      verde **sem nenhuma asserção alterada**
- [ ] [215-I3] e [215-I16] provam que a trava T2 recusa `p_loja_id` alheio de lojista autenticado
- [ ] [215-I4] prova recusa de `p_loja_id` incoerente **sob `service_role`**
- [ ] [215-I6] e [211-G5] provam atomicidade com falha injetada no meio da permutação
- [ ] [215-I13] prova `42501` para `anon` (revoke efetivo)
- [ ] as 7 travas assinadas uma a uma com `arquivo:linha` pelo `auditar`
- [ ] `reordenarOpcionaisDaCategoriaAdmin` sem nenhum `.from(...).update` — grep vazio
- [ ] CAMADA 4 do enforcement descobre ≥ 2 chamadas `svc.rpc` e falha se `p_loja_id` sair do payload
- [ ] `npx supabase migration list` com `Remote` preenchida nas duas migrations
- [ ] `reordenar_itens_do_grupo_opcional` presente em `Database["public"]["Functions"]`
- [ ] `npx tsc --noEmit` → `npm run lint` (0 erros) → `npm test` → `npm run build`, sem warning novo
- [ ] nenhum secret no client; `createServiceClient` ausente do caminho do lojista
- [ ] nenhum dado pessoal real em seed ou teste (donos e lojas fictícios, `@teste.local`)
- [ ] `verificar` exercitou **painel** e **hub admin** contra o cloud após o push
