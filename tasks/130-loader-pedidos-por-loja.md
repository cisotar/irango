# [130] Variantes de query de pedidos escopadas por `lojaId` (`svc, lojaId`)

**crítica:** SIM (TDD red-first)
**Mundo:** infra (query server-only)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rotas 2, 3, 4 e §Modelos)

## Objetivo
Criar variantes de leitura de pedidos escopadas por `lojaId` sob `service_role` (que bypassa RLS), para o hub admin — sem depender de `auth` do dono. Isolamento cross-tenant garantido pelo `.eq("loja_id", lojaId)` explícito.

## Escopo
- [ ] Em `lib/supabase/queries/pedidos.ts`, criar `listarPedidosDaLoja(svc, lojaId)` e `buscarPedidoDaLoja(svc, lojaId, id)`, espelhando `listarPedidosDoDono`/`buscarPedidoDoDono` mas com `.eq("loja_id", lojaId)` (e `.eq("id", id)`) explícitos.
- [ ] Retornar os mesmos tipos (`PedidoComItens`) usados pelas pages.

## Fora de escopo
Pages admin (138/139/140). Actions de escrita (133). Nenhuma escrita.

## Reuso esperado
- Tipos e shape de select já em `pedidos.ts` — reusar a mesma projeção.
- Client `service_role` de `lib/supabase/service.ts`.

## Segurança
- Cross-tenant: sob `service_role` a RLS não protege — a isolação vem SÓ do `.eq("loja_id", lojaId)`. Um esquecimento vaza pedidos/PII de outra loja. Leitura de PII do cliente é acesso autorizado do admin (a page re-prova admin no layout), mas deve ser estritamente escopada.

## Critério de aceite
- [ ] (RED-first) Teste de isolamento: `listarPedidosDaLoja(svc, lojaA)` e `buscarPedidoDaLoja(svc, lojaA, idDeB)` nunca retornam linha da loja B.
- [ ] Query de loja A retorna exatamente os pedidos de A (paridade com `listarPedidosDoDono` para o dono de A).

---

## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (não recriar nada disto):**

- `src/lib/supabase/queries/pedidos.ts` — módulo canônico de leitura de `pedidos`. Já expõe:
  - Tipos `Pedido`, `ItemPedido`, `ItemPedidoOpcional`, `ItemPedidoComOpcionais`, `PedidoComItens` e `FiltrosPedidos` — **reusar tal qual**; as novas funções retornam `PedidoComItens[]` / `PedidoComItens | null`, os mesmos tipos que as pages 138/139/140 já esperam. Nenhum tipo novo.
  - A projeção de select `"*, itens_pedido(*, itens_pedido_opcionais(*))"` — **reusar exatamente a mesma string** (join aninhado idêntico ao de `listarPedidosDoDono`/`buscarPedidoDoDono`), para paridade de shape com o painel.
  - `schemaUuid = z.guid()` (linha 16) — já existe no módulo para validar formato de UUID sem consultar o banco (evita `22P02`); reusar em `buscarPedidoDaLoja` para o `id`.
  - `listarPedidosDoDono(client, filtros?)` e `buscarPedidoDoDono(client, pedidoId)` (linhas 64-92) — as variantes do painel que derivam a loja de `auth` via RLS. As novas funções são o **espelho `(svc, lojaId)`** delas: mesma projeção, mesma ordenação, mesmo `maybeSingle`/propagação de erro, só acrescentando `.eq("loja_id", lojaId)` explícito.
- `src/lib/supabase/queries/categorias.ts` — **precedente do shape `(client, lojaId)` com `.eq("loja_id", lojaId)`** (`buscarCategorias`, linhas 19-30). É exatamente o padrão a seguir: recebe o client por parâmetro, escopa por `loja_id` na query, propaga `error`, `[]` = sem linha.
- `src/lib/supabase/service.ts` — `createServiceClient()` (BYPASSRLS, `server-only`). **NÃO é chamado dentro de `pedidos.ts`** (as funções recebem o `Client` por parâmetro, para testabilidade e escolha de role pelo caller — regra do topo de `pedidos.ts`). O `svc` é injetado pelo loader admin (issue 138), seguindo `carga.ts`.
- `src/app/admin/assinantes/[lojaId]/carga.ts` — **precedente do loader admin** que orquestra `validarLojaIdAdmin` → `verificarAdminSaaS()` → `createServiceClient()` → queries `(svc, lojaId)`. As funções desta issue são consumidas por um loader assim (issue 138), **não** por esta issue.
- `src/lib/supabase/queries/pedidos.test.ts` — suíte camada 2 (mock supabase-js) já existente; o `makeClient`/`selectPediuItens`/thenable serão reusados como base pela fase RED.
- `tests/migrations/queries_pedidos.test.ts` + `tests/helpers/pglite.ts` (`asService`/`asAnon`/`asUser`) — harness camada 1 (SQL/RLS real) já existente; base para o teste de isolamento sob `service_role`.

**O que precisa ser criado (e por que não dá pra reusar):** apenas duas funções em `pedidos.ts` — `listarPedidosDaLoja(svc, lojaId, filtros?)` e `buscarPedidoDaLoja(svc, lojaId, id)`. Não dá pra reusar `listarPedidosDoDono`/`buscarPedidoDoDono` porque essas dependem de RLS derivando a loja de `auth.uid()` — sob `service_role` (BYPASSRLS) elas retornariam pedidos de **todas** as lojas. A variante nova é necessária justamente para injetar o escopo `.eq("loja_id", lojaId)` que a RLS não fornece neste role.

### Camada que garante cada invariante (cliente ↔ servidor)

| Invariante | Camada que garante |
|-----------|--------------------|
| Isolamento cross-tenant (loja A nunca vê pedido de B) sob `service_role` | **Server-only, na query** — `.eq("loja_id", lojaId)` explícito. RLS **não** protege aqui (service_role bypassa). Esta função é o único ponto de enforcement da isolação. |
| Detalhe por id de outra loja → não encontrado | **Server-only, na query** — `.eq("loja_id", lojaId).eq("id", id).maybeSingle()`. O duplo `.eq` garante que um `id` válido de outra loja retorne `null`, não a linha. |
| Autoridade de admin antes de elevar a service_role | **Fora desta issue** — no loader (`carga.ts`/issue 138): `verificarAdminSaaS()` antes de `createServiceClient()`. Esta função **recebe** o `svc` já elevado; não cria client nem prova admin (mantém a regra "funções recebem o Client por parâmetro" do módulo). |
| `id` em formato inválido não vira query (`22P02`) | **Server-only, na query** — `schemaUuid.safeParse(id)` antes do `.from()`, tratado como "sem linha" (`null`) — mesmo padrão de `buscarPedidoPorToken`. |

> Nota de segurança (issue crítica): esta é uma função **server-only puramente de leitura**; não há `'use client'` envolvido, nenhum valor monetário é recalculado (leitura de `total` já persistido), e a PII do cliente lida é acesso autorizado do admin (a page re-prova admin no layout). A única invariante crítica é a isolação por `lojaId`, garantida 100% no servidor pela query.

### Cenários

**Caminho Feliz:**
1. Loader admin (issue 138) valida `lojaId` e prova admin, cria `svc` (service_role).
2. `listarPedidosDaLoja(svc, lojaId)` → `SELECT *, itens_pedido(...) WHERE loja_id = lojaId ORDER BY criado_em DESC` → retorna `PedidoComItens[]` só da loja-alvo.
3. `buscarPedidoDaLoja(svc, lojaId, id)` → `... WHERE loja_id = lojaId AND id = id` via `maybeSingle()` → retorna o `PedidoComItens` da loja-alvo.

**Casos de Borda:**
- Loja sem pedidos → `listarPedidosDaLoja` retorna `[]` (não erro).
- `id` de pedido de **outra loja** → `buscarPedidoDaLoja` retorna `null` (o `.eq("loja_id")` filtra antes do `id`).
- `id` inexistente → `null`.
- `id` em formato não-UUID → `null` sem tocar o banco (`schemaUuid.safeParse`).
- Filtro por status (paridade com `listarPedidosDoDono`): quando `filtros?.status` presente, aplica `.eq("status", ...)`; ausente, não aplica.
- `lojaId` não-UUID: **fora do contrato desta função** — a validação de `lojaId` é responsabilidade do loader (`validarLojaIdAdmin`, precedente `carga.ts`). A função assume `lojaId` já validado (mesma premissa de `buscarCategorias`). Não duplicar a validação aqui.

**Tratamento de Erros:** propagar o `error` do PostgREST (`if (error) throw error`) — nunca mascarar como `null`/`[]` (`seguranca.md` §14, regra do topo de `pedidos.ts`). Mensagem genérica ao usuário fica a cargo da page (error boundary); o detalhe só no log do servidor.

### Schema de Banco

**Nenhuma mudança.** Sem tabela, coluna, migration ou RLS nova. Opera sobre `pedidos` / `itens_pedido` / `itens_pedido_opcionais` existentes (todas já com `loja_id`/FK e RLS — `schema.md`, `seguranca.md` §2). A isolação desta leitura **não vem de RLS** (service_role bypassa) — vem do `.eq("loja_id", lojaId)` na query.

### Validação (zod)

Sem schema de form novo. Único uso de zod: `schemaUuid` (`z.guid()`) **já existente** em `pedidos.ts`, reusado para o `id` em `buscarPedidoDaLoja`.

### Recálculo no Servidor

Não se aplica — issue é de **leitura**. Nenhum valor monetário é recebido do cliente nem recalculado; `total`/`subtotal` já estão persistidos no pedido e são lidos como snapshot autoritativo.

### Testes RED (fase `tdd`, ANTES do código — issue crítica: SIM)

O agente `tdd` escreve dois níveis, espelhando a estrutura já usada em `queries_pedidos.test.ts`:

**Camada 2 — contrato TS / mock supabase-js** (arquivo: estender `src/lib/supabase/queries/pedidos.test.ts`). Reusar o `makeClient`/`selectPediuItens`. As funções ainda não existem → o teste cai vermelho no import/execução. Casos:
1. `listarPedidosDaLoja(svc, LOJA_A)` chama `.from("pedidos")`, faz o join de itens (`selectPediuItens`), **aplica `.eq("loja_id", LOJA_A)`** e ordena por `criado_em` desc. — *Este é o guard central: prova que o `.eq("loja_id")` é emitido; sem ele a isolação vaza sob service_role.*
2. `listarPedidosDaLoja` com `{ status }` aplica também `.eq("status", ...)`; sem filtro, não aplica (paridade com `listarPedidosDoDono`).
3. `buscarPedidoDaLoja(svc, LOJA_A, id)` aplica **`.eq("loja_id", LOJA_A)` E `.eq("id", id)`** e usa `maybeSingle`.
4. `buscarPedidoDaLoja` com `id` não-UUID → `null` sem chamar `.from()` (não vira query).
5. Ambas propagam o `error` do PostgREST (`rejects.toEqual(erro)`) — anti-falso-verde contra stub `throw`.

**Camada 1 — SQL/RLS real sob `service_role`** (arquivo novo: `tests/migrations/queries_pedidos_por_loja.test.ts`, ou estender `queries_pedidos.test.ts`). Reusar `criarCenario` (loja A com pedido+item, loja B com pedido). Prova o comportamento da SQL equivalente sob `asService` (BYPASSRLS) — que é onde a RLS **não** protege:
6. **ISOLAMENTO (crítico):** `asService` com `WHERE loja_id = lojaA` retorna só o pedido de A; **`c.pedidoB` nunca aparece**. Anti-falso-verde: confirmar via `existeId` que `pedidoB` realmente existe (a ausência é pelo `.eq`, não por dado faltando).
7. **DETALHE cross-loja (crítico):** `asService` com `WHERE loja_id = lojaA AND id = c.pedidoB` → 0 linhas (`null`). Anti-falso-verde: `pedidoB` existe. — *Prova que um id válido de B não vaza pela função de detalhe de A.*
8. **Contraste (prova que o bug é real):** `asService` com `SELECT * FROM pedidos` **sem** `.eq("loja_id")` retorna A **e** B (2 linhas) — evidencia que sob service_role a isolação depende exclusivamente do `.eq`, justificando a existência da função.

O `tdd` confirma o vermelho real (funções inexistentes na camada 2; na camada 1 as asserções descrevem o contrato que a GREEN implementa) e **PARA**.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/supabase/queries/pedidos.ts` — adicionar `listarPedidosDaLoja(svc, lojaId, filtros?)` e `buscarPedidoDaLoja(svc, lojaId, id)`, espelhando as variantes `*DoDono`. Sem tocar as funções existentes nem os tipos.
- `src/lib/supabase/queries/pedidos.test.ts` — adicionar os casos camada 2 (fase RED).

**Criar:**
- `tests/migrations/queries_pedidos_por_loja.test.ts` — isolamento sob service_role (fase RED). *(Alternativa aceitável: estender `tests/migrations/queries_pedidos.test.ts`.)*

**NÃO tocar:**
- Pages/loaders admin (issues 138/139/140) e `carga.ts` — fora de escopo; consomem estas funções depois.
- Actions de escrita/status (issue 133) — esta issue não escreve nada.
- `listarPedidosDoDono`/`buscarPedidoDoDono` e os tipos — reuso sem alteração (mexer neles regride o painel do lojista).
- RLS/migrations — nenhuma mudança de schema.

### Dependências Externas

Nenhuma nova. `zod` (`z.guid()`), `@supabase/supabase-js` (tipos) e o harness `@electric-sql/pglite` já estão no projeto.

### Ordem de Implementação

Issue **crítica** → RED antes do código de produção:
1. **`/tdd` (RED):** camada 2 (mock, `.eq("loja_id")` + `.eq("id")` + propagação de erro) e camada 1 (isolamento sob service_role, cases 6-8). Confirmar vermelho real e parar.
2. **`/execute` (GREEN):** implementar as duas funções em `pedidos.ts` espelhando `listarPedidosDoDono`/`buscarPedidoDoDono` + `.eq("loja_id", lojaId)` (e `.eq("id", id)` no detalhe). Mínimo para o verde; depois conferir paridade de shape com as variantes do dono.
