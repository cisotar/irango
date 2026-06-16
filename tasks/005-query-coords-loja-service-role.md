# [005] Query server-only: buscar coords da loja via service_role

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 001
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Criar uma query reutilizável que lê apenas `latitude`/`longitude` da tabela base `lojas` por `loja_id`, usando o client `service_role` — sem expor coords na `vitrine_lojas`. Consumida tanto pelo preview (`calcularFreteAction`) quanto pelo autoritativo (`criarPedido`).

## Escopo
- [ ] Função em `lib/supabase/queries/lojas.ts` (ex.: `buscarCoordsLoja(svc, lojaId): Promise<{ latitude: number; longitude: number } | null>`).
- [ ] `SELECT latitude, longitude FROM lojas WHERE id = $1` — apenas as duas colunas.
- [ ] Retorna `null` quando a loja não tem coords (`latitude`/`longitude` NULL) ou não existe.
- [ ] Recebe o client por parâmetro (service_role); a query NÃO instancia o client.

## Fora de escopo
- Geocoding do CEP do cliente (issues 006/007).
- Qualquer escrita de coords (issue 008).
- Adicionar coords à view `vitrine_lojas` — proibido por design.

## Reuso esperado
- `lib/supabase/queries/lojas.ts` existente — adicionar a função junto às demais (não criar `.from('lojas')` inline nas actions, conforme convenção DRY de queries).
- Padrão de isolamento de dado sensível via service_role já usado por `criarPedido`.

## Segurança
- RN-4 / spec §"Como o preview obtém as coords": coords são internas ao servidor; só acessíveis via service_role. Não regride a privacidade da view pública.
- Caller é responsável por escopar por `loja_id` correto.

## Critério de aceite
- [ ] (teste vermelho primeiro) Teste pglite/RLS: a função retorna o par quando a loja tem coords; `null` quando NULL; e confirma que `vitrine_lojas` NÃO contém as colunas de coords.
- [ ] `pnpm test` verde após implementação.

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** as coords da loja (`latitude`/`longitude`) são um **dado interno do servidor** — por decisão de design (spec §Modelos de Dados, seguranca.md §19) elas **não** estão na view pública `vitrine_lojas`. Os dois consumidores que precisam delas (`calcularFreteAction` no preview, `criarPedido` no autoritativo) só podem lê-las via `service_role` lendo a tabela base `lojas`. Hoje **não existe** uma query para isso, e a convenção DRY (architecture.md §8, seguranca.md §7) proíbe `.from('lojas')` inline nas actions. A issue cria o primitivo de leitura que faltava.

**Por que é (relativamente) complexo:** não é um patch de UI — é um primitivo de dados consumido por **duas camadas distintas** (preview público + valor autoritativo) e que toca uma **invariante de privacidade** (coords nunca vazam para a view pública / para o anon). A assinatura precisa ser exata porque será congelada por dois callers nas issues 006 e 007. É `crítica: SIM` (TDD red-first) porque protege a fronteira service_role ↔ anon.

> **Nota de escopo (sem remendo):** esta issue é uma adição limpa de um primitivo ausente, **não** um remendo. Ela centraliza o acesso (fonte única) em vez de espalhar `.from('lojas').select('latitude,longitude')` por duas actions. Rejeitar o alternativo "ler coords inline em cada action" é justamente evitar o anti-padrão de "guards do mesmo invariante em N caminhos".

### Mapa de Impacto

```
[ISSUE 006] criarPedido (actions/pedido.ts) ──┐
   svc = createServiceClient()                │
                                              ├─→ buscarCoordsLoja(svc, lojaId)   ← ESTA ISSUE (005)
[ISSUE 007] calcularFreteAction (actions/    │        │
            frete.ts) — ATENÇÃO: hoje usa     │        └─ SELECT latitude, longitude
            client ANON; passa a precisar de  │           FROM lojas WHERE id = $1   [TABELA BASE]
            um svc service_role só p/ coords ─┘              (maybeSingle → null se não existe)
                                                            mapeia: coords NULL → retorna null

vitrine_lojas (VIEW) ──✗── NÃO contém latitude/longitude  [invariante de privacidade: confirmada em teste]
```

**Onde cada invariante é garantida (camada):**

```
Leitura de coords da loja:
  ├── vitrine_lojas (view, anon) — [NÃO expõe coords — invariante de privacidade, spec §Modelos de Dados]
  ├── lib/supabase/queries/lojas.ts::buscarCoordsLoja — [fonte ÚNICA de leitura de coords; exige service_role]
  ├── actions/frete.ts (preview)   — [cliente — só UX; recebe taxa, NUNCA coords/distanciaKm]
  └── actions/pedido.ts (autoritativo) — [Server Action — AUTORITATIVO; recalcula frete do banco]

Quem garante que o client nunca lê coords:
  ├── RLS de `lojas` (sem SELECT anon — seguranca.md §2/§19) — banco recusa anon
  └── service.ts (`import "server-only"`) — build quebra se importado no client
```

> **Regra cliente↔servidor (obrigatória):** coords são dado sensível de servidor. A função **exige** client `service_role` injetado pelo caller (não instancia client, não lê `process.env`). Não há camada-cliente legítima — qualquer leitura de coords no cliente é o vetor que esta issue fecha. Por isso o teste de aceite **prova** que `vitrine_lojas` não tem as colunas (impossibilita o caller "esperto" de ler coords via anon/view).

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/supabase/queries/lojas.ts` | Queries reusáveis de `lojas`/`vitrine_lojas`. Convenção: recebem `Client` por param, não instanciam, propagam `error`, `maybeSingle` em leitura de 1 linha, `null` = sem linha. | **+ função `buscarCoordsLoja`** ao final do arquivo, seguindo o molde de `buscarLojaParaPedido` (service_role, por id). |
| `src/lib/supabase/queries/lojas.test.ts` | Testes de contrato TS via mock encadeável `from().select().eq().maybeSingle()`. | **+ casos** para `buscarCoordsLoja` (ver Cenários). Camada 2 (contrato TS, mock). |
| `tests/migrations/lojas_coordenadas.test.ts` | Teste pglite do schema (colunas + CHECK). | **+ caso** que prova `vitrine_lojas` NÃO tem `latitude`/`longitude` (camada 1, SQL real). Alternativa: arquivo novo `tests/migrations/vitrine_lojas_sem_coords.test.ts`. |
| `src/lib/database.types.ts` | Tipos gerados. `lojas.Row` tem `latitude/longitude: number | null` (L356/358); `vitrine_lojas.Row` **não** os tem (L797-817). | **Nada** — tipos já suportam a query. Não regenerar. |
| `src/lib/supabase/service.ts` | Factory `createServiceClient()` (BYPASSRLS, server-only). | **NÃO tocar** — o caller injeta; a query não conhece o factory. |
| `src/lib/actions/frete.ts` / `src/lib/actions/pedido.ts` | Consumidores. | **NÃO tocar nesta issue** — consumo é 006/007. |

### Decisões de Design

**D1 — Tipo de retorno: `{ latitude: number; longitude: number } | null` (não `LojaCompleta`, não tupla)**
- (a) Retornar `Pick<>` de duas colunas não-null: força o caller a tratar `null` (loja sem coords) num único ponto e nunca expõe colunas sensíveis acidentalmente. **Escolhida.**
- (b) Retornar `LojaCompleta`: vaza `dono_id`/`assinatura_*` desnecessariamente e viola minimização — rejeitada.
- **Por quê:** o `SELECT` projeta só `latitude, longitude` (minimização de dado, seguranca.md §7 "escopar manualmente"). O contrato `number` (não `number | null`) interno é garantido porque a função só retorna o objeto quando **ambos** são não-null; senão retorna `null`. Isso casa com o CHECK `lojas_coords_par_check` (par tudo-ou-nada).

**D2 — Coords NULL e loja inexistente colapsam no MESMO `null`**
- A issue pede `null` para os dois casos. O caller (RN-3) trata "loja sem coords" e "loja inexistente" identicamente: zonas `raio_km` ignoradas silenciosamente. Não há valor em distinguir. **Escolhida:** após `maybeSingle()`, se `data == null` (não existe) **ou** `data.latitude == null` **ou** `data.longitude == null` → retorna `null`.
- **Edge do CHECK:** o CHECK garante que `latitude`/`longitude` são ambos null ou ambos não-null. Mesmo assim, checar os **dois** explicitamente (não só um) é defensivo e satisfaz o type-narrowing do TS para `number`.

**D3 — Assinatura: client por parâmetro, tipado `SupabaseClient<Database>`**
- Idêntico às demais queries do arquivo (alias `Client = SupabaseClient<Database>`). A função **não** instancia, **não** lê `process.env` — o caller injeta o `svc` de `createServiceClient()`. Garante testabilidade (mock) e mantém a escolha de role no caller (architecture.md §8 / convenção do header do arquivo).
- **Documentar no JSDoc:** "EXIGE service_role — `lojas` não tem SELECT anon (§19); via anon/view retornaria zero/coluna ausente". Mesmo tom dos JSDocs de `buscarLojaParaPedido`/`slugExiste`.

**D4 — `maybeSingle()` (não `single()`)**
- `single()` lança quando 0 linhas; `maybeSingle()` retorna `data: null`. A função precisa de `null` (não exceção) para loja inexistente. Consistente com todas as leituras de 1 linha do arquivo. Erro real do PostgREST (`error != null`) continua sendo **propagado** (`throw error`) — nunca mascarado como `null` (seguranca.md §14).

### Cenários

**Caminho feliz:** loja existe e tem coords → `{ latitude: -23.5, longitude: -46.6 }`.

**Bordas:**
- Loja existe, coords NULL (loja nunca geocodificada — RN-3) → `null`.
- Loja inexistente (`maybeSingle` → `data: null`) → `null`.
- Só uma coord não-null: impossível por CHECK `lojas_coords_par_check`, mas a função ainda retorna `null` defensivamente (checa as duas).
- `vitrine_lojas` NÃO tem as colunas → provado em teste de schema (impede caller de driblar via view/anon).
- Erro do PostgREST (db down, permissão) → **propaga** `throw error` (não vira `null`).

**Tratamento de erro:** a query propaga `error` cru (responsabilidade do caller traduzir para mensagem genérica + log, conforme já fazem `criarPedido`/`calcularFreteAction` no `catch`). A query **não** loga nem engole — consistente com as demais funções do arquivo.

**Não aplicável aqui:** race de duplo submit, cupom, sessão expirada, CEP fora de zona — pertencem aos callers (006/007), não a uma query de leitura pura.

### Contratos de Dados

Nenhuma mudança de schema, migration ou RLS. As colunas já existem (migration `20260616194631_lojas_coordenadas.sql`, issue 001) e os tipos já estão em `database.types.ts`. **Não** regenerar tipos. Invariante de privacidade (`vitrine_lojas` sem coords) é **pré-existente** — esta issue apenas a **verifica** em teste.

**Assinatura exata:**

```ts
/**
 * Coords (latitude/longitude) da loja para cálculo de frete por raio (issues 006/007).
 * Fonte: TABELA base `lojas` — a view `vitrine_lojas` NÃO expõe coords por design
 * (spec §Modelos de Dados, seguranca.md §19). Projeta SÓ as duas colunas (minimização).
 *
 * EXIGE client **service_role** (BYPASSRLS) injetado pelo caller: `lojas` não tem
 * SELECT anon (§2/§19) — via anon retornaria zero linhas. Consumida pelo preview
 * (`calcularFreteAction`) e pelo autoritativo (`criarPedido`), ambos server-only.
 *
 * Retorna `null` quando a loja não existe OU não tem coords (RN-3: par NULL → zonas
 * raio_km ignoradas silenciosamente). Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarCoordsLoja(
  client: Client,
  lojaId: string,
): Promise<{ latitude: number; longitude: number } | null>
```

**Implementação proposta:**

```ts
export async function buscarCoordsLoja(
  client: Client,
  lojaId: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const { data, error } = await client
    .from("lojas")
    .select("latitude, longitude")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  if (data == null || data.latitude == null || data.longitude == null) {
    return null;
  }
  return { latitude: data.latitude, longitude: data.longitude };
}
```

### Recálculo no Servidor

Não há dinheiro nesta query. Mas ela é **insumo** do recálculo autoritativo: `criarPedido` (006) usa as coords retornadas para computar `distanciaKm` (haversine) e alimentar `calcularFrete` server-side. O cliente nunca envia coords nem `distanciaKm` (RN-4) — esta query é o único caminho de obtenção dessas coords, e é server-only por construção.

### Casos de Teste (fase RED primeiro)

**Camada 2 — contrato TS (mock), em `src/lib/supabase/queries/lojas.test.ts`** (reusa o `makeClient` existente):
1. Consulta a TABELA `lojas` (`from('lojas')`), **não** `vitrine_lojas`; filtra `eq('id', lojaId)`; usa `maybeSingle`. Asserir também `select` chamado com `"latitude, longitude"` (prova minimização — só as 2 colunas).
2. Retorna o par `{ latitude, longitude }` quando ambos não-null.
3. Retorna `null` quando `latitude`/`longitude` são NULL (`data` com coords null).
4. Retorna `null` quando a loja não existe (`data: null`).
5. (defensivo) Retorna `null` quando só uma coord é não-null.
6. **Propaga** o `error` do PostgREST (`rejects`) — não mascara como `null`.

**Camada 1 — schema real (pglite), em `tests/migrations/`:**
7. `vitrine_lojas` **NÃO** contém colunas `latitude`/`longitude` — `SELECT latitude FROM vitrine_lojas` deve falhar (coluna inexistente). Prova a invariante de privacidade no SQL real, fechando o vetor "ler coords via view/anon".

> **Stub RED:** criar `buscarCoordsLoja` em `lojas.ts` com `throw new Error('TODO: GREEN')` para que o RED caia na **asserção**, não num erro de type-check (mesmo padrão documentado no header de `lojas.test.ts`).

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/supabase/queries/lojas.ts` — adicionar `buscarCoordsLoja` (≈12 linhas) ao final, após `garantirLojaDoDono`.
- `src/lib/supabase/queries/lojas.test.ts` — adicionar bloco `describe` com os 6 casos de contrato (reusa `makeClient`).
- `tests/migrations/lojas_coordenadas.test.ts` — adicionar o caso "vitrine_lojas sem coords" (ou criar `tests/migrations/vitrine_lojas_sem_coords.test.ts`).

**NÃO tocar (com motivo):**
- `src/lib/supabase/service.ts` — caller injeta o client; a query não conhece o factory.
- `src/lib/database.types.ts` — tipos já suportam; nada a regenerar.
- `src/lib/actions/frete.ts` / `pedido.ts` — consumo é 006/007.
- `vitrine_lojas` (view) / migrations de schema — coords proibidas na view por design; nada muda.

### Dependências Externas

Nenhuma nova. Usa `@supabase/supabase-js` (já presente), `vitest` (já presente), `@electric-sql/pglite` via `tests/helpers/pglite.ts` (já presente). **Não reinventa nada** — segue o molde de `buscarLojaParaPedido` no mesmo arquivo.

### Ordem de Implementação

1. **RED (agente `tdd`):** stub `buscarCoordsLoja` em `lojas.ts` (`throw new Error('TODO: GREEN')`) + casos de teste (contrato TS + pglite vitrine_lojas-sem-coords). Confirmar vermelho com output real e PARAR. — *Dependência: precede a GREEN porque é `crítica: SIM`.*
2. **GREEN (agente `executar`):** implementar `buscarCoordsLoja` conforme a assinatura/implementação acima. — *Depende do RED existir.*
3. **Validação:** `pnpm test` verde + `pnpm build` (constraint de export `'use server'` não se aplica — `lojas.ts` é módulo neutro, sem `'use server'`; ainda assim rodar build é barato e fecha o ciclo).

### Checklist de Validação Pós-Implementação
- [ ] `pnpm build` sem warnings novos
- [ ] `pnpm test` verde (casos de contrato + pglite vitrine_lojas)
- [ ] Teste prova que `vitrine_lojas` NÃO tem `latitude`/`longitude` (invariante de privacidade)
- [ ] `select` projeta SÓ `latitude, longitude` (minimização — nenhuma coluna sensível)
- [ ] Função **não** instancia client nem lê `process.env` (recebe `svc` por param)
- [ ] Erro do PostgREST é **propagado** (não mascarado como `null`)
- [ ] Coords NULL e loja inexistente → ambos `null`
