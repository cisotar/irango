# [080] Server Actions de admin do SaaS (cortesia/suspender/reativar) + guard `SAAS_ADMIN_USER_ID`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [073], [074]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Implementar o único caminho NÃO-webhook autorizado a escrever `assinatura_status`: ações do dono do SaaS para conceder/revogar cortesia, suspender e reativar lojas — todas com `service_role` (passando pelo trigger) e protegidas por verificação `auth.uid() === SAAS_ADMIN_USER_ID` antes de qualquer efeito.

## Escopo
- [ ] Helper server-only `verificarAdminSaaS()` que compara `auth.uid()` com `process.env.SAAS_ADMIN_USER_ID`; qualquer outra identidade → erro/redirect. Sem tabela de admins (RN-13).
- [ ] Server Actions (ex: `src/app/admin/assinantes/actions.ts`):
  - `concederCortesia(loja_id)` → `assinatura_status='cortesia'`, `assinatura_fim_periodo=NULL`, `billing_provider=NULL`.
  - `revogarCortesia(loja_id)` → `assinatura_status='cancelada'`, `assinatura_fim_periodo=now()` (corte imediato).
  - `suspenderLoja(loja_id)` → `assinatura_status='suspensa'`, `assinatura_fim_periodo=now()` (corte imediato, sem carência).
  - `reativarLoja(loja_id)` → `assinatura_status='ativa'` (override explícito).
- [ ] Todas via `createServiceClient()` (NÃO PostgREST autenticado), `verificarAdminSaaS()` no início, `revalidatePath('/admin/assinantes')` + toast.
- [ ] Documentar nova env `SAAS_ADMIN_USER_ID` (server-only, sem `NEXT_PUBLIC_`).

## Fora de escopo
A tabela/tela admin (082). Edição de planos (fora do escopo v1).

## Reuso esperado
- `createServiceClient()` (`src/lib/supabase/service.ts`).
- Trigger `lojas_protege_billing` (074) — service_role passa.
- Padrão de Server Action + zod (architecture §8).

## Segurança
- RN-12/RN-13/RN-14: esta é a ÚNICA exceção ao "só webhook escreve status". Se `verificarAdminSaaS` falhar ou for contornável, um lojista autenticado promove a própria loja a `cortesia`/`ativa` (bypass total de cobrança). Verificação server-side antes de qualquer efeito é invariante → crítica máxima.
- `SAAS_ADMIN_USER_ID` nunca com `NEXT_PUBLIC_`.

## Critério de aceite
- [ ] Teste RED: chamada por usuário com `uid !== SAAS_ADMIN_USER_ID` (inclusive lojista autenticado) é rejeitada antes de qualquer escrita; chamada pelo admin aplica o status/fim_periodo correto via service_role; `revogarCortesia` corta imediato (`fim_periodo=now()`).
- [ ] `next build` passa.

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** o sistema tem exatamente UMA autoridade de billing (webhook → `service_role` → trigger). Esta issue introduz a *segunda e última* exceção a esse invariante: um caminho não-webhook que escreve `assinatura_status`. A invariante violada se a implementação falhar não é "um bug de UI" — é a fronteira de autorização do SaaS inteiro: se `verificarAdminSaaS()` for contornável, qualquer lojista autenticado se auto-concede `cortesia`/`ativa` e burla cobrança (bypass total de receita). O problema real é **provar criptograficamente a identidade do único admin antes de qualquer efeito, e elevar privilégio (`service_role`) só depois dessa prova** — não é "escrever 4 UPDATEs".

**Por que é complexo:**
- **Inverte o gate de privilégio padrão.** Toda outra action do painel usa o client AUTENTICADO e deixa a RLS isolar por dono (`produto.ts`, `cupom.ts`). Aqui a RLS é deliberadamente *bypassada* (`service_role`/BYPASSRLS) e o trigger `lojas_protege_billing_trg` é deliberadamente *atravessado*. As duas únicas barreiras do banco são desligadas de propósito — logo a verificação de admin em código é a **única** linha de defesa restante. Não há rede de segurança no banco para esta action.
- **Toca contrato de billing compartilhado.** Escreve as mesmas colunas que o webhook Hotmart (`assinatura_status`, `assinatura_fim_periodo`, `billing_provider`) — precisa ser consistente com `eventoParaStatus`/`aplicarStatusAssinatura` e com o CHECK estendido (073) e a lista de colunas protegidas do trigger (074).
- **Cross-cutting:** env nova (server-only) + nova superfície de rota (`/admin/*`) + reuso do `service_role` client + interação com o gate de painel (`acessoPainel.ts` já trata `cortesia`/`suspensa`).
- **É crítica (TDD red-first):** o critério de aceite exige teste vermelho de autorização antes da implementação.

### Mapa de Impacto

```
/admin/assinantes/actions.ts  (NOVO — 'use server')
  │
  ├─ verificarAdminSaaS()                       [helper interno, mesma file]
  │     ├─ createClient() (auth, src/lib/supabase/server.ts)
  │     │     └─ supabase.auth.getUser()  → user.id  [AUTORITATIVO: cookie HttpOnly, não forjável]
  │     └─ compara user.id === process.env.SAAS_ADMIN_USER_ID  [env server-only]
  │           └─ FALHA → lança/redireciona ANTES de qualquer escrita
  │
  ├─ concederCortesia(loja_id) ─┐
  ├─ revogarCortesia(loja_id)  ─┤
  ├─ suspenderLoja(loja_id)    ─┼─→ verificarAdminSaaS()  (gate, sempre 1º)
  └─ reativarLoja(loja_id)     ─┘     │
                                      └─→ aplicarStatusAdmin(svc, loja_id, patch)   [query NOVA]
                                            └─ createServiceClient() (service_role, BYPASSRLS)
                                                  └─ UPDATE lojas SET assinatura_* ...
                                                        ⤷ passa pelo trigger lojas_protege_billing_trg
                                                          (service_role está na allowlist — NÃO bloqueia)
                                                          ⤷ tabela lojas (colunas billing)
                                            └─ revalidatePath('/admin/assinantes')
                                                  ⤷ re-renderiza TabelaAssinantes (issue 082)
```

Leitura cruzada: `assinatura_status` gravado aqui é lido depois por `acessoPainel.ts::assinaturaLibera` (gate de painel) — `cortesia` libera sempre, `suspensa` bloqueia sempre, `cancelada`+`fim_periodo=now()` bloqueia após carência. Coerência já garantida porque `acessoPainel.ts` e `assinatura.ts` já conhecem o union completo.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---------|-------------|------------|
| `src/lib/supabase/service.ts` | `createServiceClient()` (BYPASSRLS, `import "server-only"`) | **Reusado sem alteração** — fonte do client que passa pelo trigger |
| `src/lib/supabase/server.ts` | `createClient()` autenticado via cookies | **Reusado** — para `auth.getUser()` no helper de admin |
| `src/lib/supabase/queries/webhookHotmart.ts` | `aplicarStatusAssinatura(svc, lojaId, dados)` escreve billing via service_role | **Padrão a espelhar.** Ver Decisão D-2: a nova query admin difere semanticamente (override explícito, sem `eventoParaStatus`), então NÃO reusa esta função literal |
| `src/lib/utils/assinatura.ts` | union `StatusAssinatura` inclui `cortesia`/`suspensa` | **Reusado** — tipos. Nenhuma mudança |
| `src/lib/utils/acessoPainel.ts` | gate de painel já trata `cortesia`/`suspensa` | **Não tocar** — só consome o status que esta action grava |
| `src/app/api/webhooks/hotmart/route.ts` | autoridade de billing #1 | **Não tocar** — referência de padrão |
| `.env.example` | documenta envs server-only (Nominatim, Google, Billing) | **Adicionar bloco `SAAS_ADMIN_USER_ID`** seguindo o padrão de comentário existente |
| `src/lib/database.types.ts` | tipos gerados; `lojas` ainda sem `billing_provider` etc. | Regenerado por **073** (dependência) — esta issue assume colunas já presentes |

**Reuso confirmado (não reinventar):**
- `createServiceClient()` → não criar outro factory.
- `createClient()` + `auth.getUser()` → padrão canônico de identidade server-side (usado em `middleware.ts`, `manifest.webmanifest/route.ts`). Não ler cookie/JWT à mão.
- `revalidatePath` de `next/cache` → idêntico a `produto.ts`.
- `StatusAssinatura` de `assinatura.ts` → tipar os patches.
- `import "@/lib/database.types"` (NÃO `@/types/supabase` — o codebase usa `database.types.ts`; `types/supabase.ts` está obsoleto).
- Não há lib externa nova. `process.env` comparado com `===` é suficiente (UUID vs UUID; ver D-3 sobre `timingSafeEqual`).

### Decisões de Design

**D-1 — Onde mora `verificarAdminSaaS()`?**
- (a) `src/lib/auth/admin.ts` (módulo neutro reusável). Prós: reusável pelo Server Component da tabela (082) e por futuras rotas `/admin/*`. Contras: a issue 080 só precisa dele nas 4 actions; 082 é fora de escopo.
- (b) helper interno em `actions.ts`. Prós: escopo mínimo da issue. Contras: 082 (lista) também precisará verificar admin → duplicação iminente.
- **Escolhida: (a) `src/lib/auth/admin.ts`** com `import "server-only"`. A issue 082 (`/admin/assinantes` Server Component) é dependência direta e *vai* reusar. Já existe a pasta `src/lib/auth/` (reconciliação). Centralizar o gate em um ponto é o oposto do anti-padrão "lista de guards em N caminhos". A função exporta `verificarAdminSaaS(): Promise<void>` (lança em falha) e `obterAdminUserId(): string` (lê+valida a env). `actions.ts` apenas importa e chama no início de cada action.

**D-2 — Reusar `aplicarStatusAssinatura` ou criar query admin própria?**
- (a) Reusar `aplicarStatusAssinatura(svc, lojaId, dados)`. Prós: DRY. Contras: aquela função sempre seta `assinatura_atualizada_em` e aceita `subscriber_code`/`plano`/`inicio` — semântica de *webhook* (renovação de ciclo). Admin precisa setar `billing_provider=NULL` (cortesia) e NÃO mexer em `subscriber_code` — campos que a função do webhook não cobre. Forçar reuso exigiria alargar o contrato dela e arriscar o caminho do webhook.
- (b) Nova query `aplicarStatusAdmin(svc, lojaId, patch)` em `src/lib/supabase/queries/adminAssinatura.ts`. Prós: patch explícito por action, sem acoplar à semântica de evento; o webhook fica intocado. Contras: pequena duplicação do `.from("lojas").update(...)`.
- **Escolhida: (b)**. As semânticas são genuinamente diferentes (override administrativo vs. transição por evento). A duplicação é uma linha de `.update()`. Mantém o caminho crítico do webhook sem regressão. A query seta `assinatura_atualizada_em = now()` (auditoria) em todos os casos.

**D-3 — Comparação da identidade: `===` ou `timingSafeEqual`?**
- (a) `user.id === process.env.SAAS_ADMIN_USER_ID`.
- (b) `crypto.timingSafeEqual`.
- **Escolhida: (a) `===`**. `timingSafeEqual` protege segredos *adivinháveis por timing* enviados pelo atacante (ex.: o `hottok` do webhook, que o atacante controla e repete). Aqui o lado comparado é o `user.id` derivado de um **cookie de sessão HttpOnly já autenticado pelo Supabase** — o atacante não envia um UUID candidato em texto livre; ele teria que possuir a sessão do admin. Não há canal de timing explorável. `===` é o padrão do projeto e correto aqui. (Mantido como decisão explícita para o auditor não reabrir.)

**D-4 — Falha de admin: `redirect()` ou retorno `{ ok:false }` ou `throw`?**
- O Server Component de `/admin/*` (082) faz `redirect('/painel')`. Para as **Server Actions** o contrato do projeto é `{ ok:true } | { ok:false; erro }` (ver `produto.ts`). Mas falha de admin NÃO é erro de domínio recuperável — é tentativa de acesso não autorizado.
- **Escolhida:** `verificarAdminSaaS()` **lança** `Error("acesso negado")` (não `redirect`, que em Server Action dispara navegação e mascara a intenção). A action **não** captura essa exceção num `{ ok:false }` amigável — deixa propagar (Next.js a transforma em erro de action). Racional: nunca devolver caminho amigável a quem não é admin; o front (082) só renderiza os botões para o admin, então um não-admin chamando a action é abuso, tratado como falha dura. Logar `console.error("[admin] acesso negado", user?.id ?? "anon")` (id é UUID, não PII sensível) antes de lançar.

**D-5 — `SAAS_ADMIN_USER_ID` ausente/vazio no env (item 5 da issue):**
- **fail-closed absoluto.** `obterAdminUserId()` lança se a env estiver ausente, vazia ou não-UUID. Consequência: `verificarAdminSaaS()` lança para *todo mundo*, inclusive o admin real. Ninguém escreve billing. Esse é o comportamento correto: um SaaS sem admin configurado deve recusar 100% das ações administrativas, jamais liberar por omissão. **Nunca** comparar contra `undefined` (um `user.id` qualquer poderia casar `undefined === undefined`? não — `getUser()` retorna string; mas a guarda explícita elimina qualquer ambiguidade). Mensagem de log: `"[admin] SAAS_ADMIN_USER_ID não configurado"`.

### Cenários

**Caminho feliz (admin autenticado):** `getUser()` → `user.id === SAAS_ADMIN_USER_ID` → `aplicarStatusAdmin` via service_role → trigger permite (service_role) → `revalidatePath` → `{ ok:true }` → toast no client (082).

**Bordas:**
- **Lojista autenticado chama a action** (id ≠ admin): `verificarAdminSaaS()` lança ANTES de instanciar `createServiceClient()` → zero escrita. (Teste RED principal.)
- **Anônimo / sessão expirada:** `getUser()` retorna `user=null` → `verificarAdminSaaS()` lança (null nunca casa o UUID). Sem escrita.
- **`SAAS_ADMIN_USER_ID` não configurado:** lança para todos (D-5).
- **`loja_id` inexistente:** `aplicarStatusAdmin` faz UPDATE com `.eq("id", loja_id)`; afeta 0 linhas. Verificar `count`/retorno e devolver `{ ok:false, erro:"Loja não encontrada." }` (sem vazar). Não é erro 500.
- **`loja_id` malformado (não-UUID):** validar com `z.string().uuid()` antes do I/O → `{ ok:false, erro:"Loja inválida." }`.
- **CHECK do banco recusa status:** impossível — os 4 status (`cortesia`/`cancelada`/`suspensa`/`ativa`) estão no CHECK estendido por 073. Se 073 não rodou, o UPDATE falha → tratado como erro genérico (e o `next build`/migrations devem rodar 073 antes — ver Ordem).
- **Race de duplo submit (admin clica 2×):** ações são idempotentes por construção (setam estado absoluto, não incremento). 2× `concederCortesia` = mesmo estado final. Sem trava necessária.
- **Trigger bloquearia se a action usasse client autenticado por engano:** é exatamente o que NÃO pode acontecer — o teste deve afirmar que a query usa `createServiceClient`, não `createClient`.

**Tratamento de erro:** toda exceção de banco → `console.error("[<action>]", e)` no servidor + retorno genérico `{ ok:false, erro:"Não foi possível concluir a ação." }` (`seguranca.md` §14). Exceção de autorização (D-4) propaga (não vira `{ ok:false }`).

### Contratos de Dados

**Sem mudança de schema nesta issue.** As colunas (`billing_provider`, `assinatura_status` com `cortesia`/`suspensa`) e a allowlist do trigger são entregues por **073 + 074** (dependências). Esta issue só ESCREVE colunas já existentes.

UPDATE aplicado por action (todos via `service_role`, sempre `assinatura_atualizada_em = now()`):

| Action | `assinatura_status` | `assinatura_fim_periodo` | `billing_provider` |
|--------|---------------------|--------------------------|--------------------|
| `concederCortesia` | `'cortesia'` | `NULL` | `NULL` |
| `revogarCortesia` | `'cancelada'` | `now()` | *(não toca)* |
| `suspenderLoja` | `'suspensa'` | `now()` | *(não toca)* |
| `reativarLoja` | `'ativa'` | *(não toca)* | *(não toca)* |

**Tipos:** assumir `src/lib/database.types.ts` já regenerado por 073 (`pnpm supabase gen types`). Patch tipado como `Database["public"]["Tables"]["lojas"]["Update"]`.

### Recálculo no Servidor

Não há valor monetário recebido do cliente nesta issue. O cliente (admin) envia **apenas `loja_id`** — nunca status, datas ou valores. Todo o estado de billing é **decidido server-side** pela própria action (constantes literais por action; `now()` calculado no servidor). Invariante de valor/permissão garantida em: (1) `verificarAdminSaaS()` server-side antes do efeito; (2) `service_role` + trigger `lojas_protege_billing_trg` como gate do banco; (3) `z.string().uuid()` no `loja_id`. Nenhuma camada cliente é autoritativa.

> Mapa da invariante "quem pode escrever billing":
> ```
> Escrita de assinatura_status aplicada em:
>   ├── /admin/assinantes/actions.ts — [Server Action — AUTORITATIVO, gate SAAS_ADMIN_USER_ID]
>   ├── src/lib/auth/admin.ts::verificarAdminSaaS — [fonte única da prova de identidade do admin]
>   ├── createServiceClient() — [única role que o trigger deixa escrever billing]
>   └── trigger lojas_protege_billing_trg — [gate do banco — bloqueia authenticated]
> ```

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/auth/admin.ts` (`import "server-only"`): `obterAdminUserId(): string` (lê+valida env, lança se ausente/inválida) e `verificarAdminSaaS(): Promise<void>` (`getUser()` → compara → lança em falha, com `console.error`).
- `src/app/admin/assinantes/actions.ts` (`'use server'`): `concederCortesia`, `revogarCortesia`, `suspenderLoja`, `reativarLoja`, cada uma `(loja_id: string) => Promise<{ ok:true } | { ok:false; erro:string }>`; valida UUID, chama `verificarAdminSaaS()`, chama `aplicarStatusAdmin`, `revalidatePath('/admin/assinantes')`.
- `src/lib/supabase/queries/adminAssinatura.ts`: `aplicarStatusAdmin(svc, lojaId, patch)` — UPDATE escopado por `id`, retorna nº de linhas afetadas (para detectar loja inexistente).
- **Testes RED** (fase `tdd`): `src/app/admin/assinantes/actions.test.ts` e/ou `src/lib/auth/admin.test.ts` — mock de `getUser` (admin / lojista / anon), asserção de que escrita NÃO ocorre para não-admin (espelhar padrão de mock de `produto.test.ts`: client raiz não-thenável, cadeia `.from()` thenável; capturar ops por tabela).

**Modificar:**
- `.env.example`: bloco comentado `SAAS_ADMIN_USER_ID=` no padrão dos demais (server-only, sem `NEXT_PUBLIC_`, explicando fail-closed se ausente).

**NÃO tocar (com motivo):**
- `src/app/api/webhooks/hotmart/route.ts` e `webhookHotmart.ts` — autoridade de billing #1; D-2 evita acoplamento.
- `src/lib/utils/acessoPainel.ts` / `assinatura.ts` — já tratam `cortesia`/`suspensa`; só consomem o status. Mexer = regressão de gate.
- `src/lib/supabase/service.ts` — reuso direto.
- Trigger / migrations de billing — entregues por 073/074.

### Dependências Externas

Nenhum pacote novo. Usa só: `next/cache` (`revalidatePath`), `zod` (validação de `loja_id`), `@supabase/*` (já na stack), `server-only`. `zod` doc: https://zod.dev — `z.string().uuid()`.

### Ordem de Implementação

1. **Pré-condição:** 073 e 074 mergeados/migrados (CHECK aceita `cortesia`/`suspensa`; trigger protege colunas novas; tipos regenerados). Sem isso o UPDATE de `cortesia`/`suspensa` viola o CHECK. *Justificativa: dependência de schema declarada na issue.*
2. **`/break` já cobriu;** começar pela **fase RED (`tdd`)**: escrever `actions.test.ts` + `admin.test.ts` falhando — afirmam (a) não-admin/anon não escreve, (b) admin escreve o patch correto por action via service_role, (c) env ausente bloqueia todos, (d) `revalidatePath` chamado. Confirmar vermelho real. *Justificativa: issue crítica.*
3. **GREEN — `src/lib/auth/admin.ts`** primeiro (as actions dependem dele).
4. **GREEN — `adminAssinatura.ts`** (query de escrita).
5. **GREEN — `actions.ts`** (compõe 3+4 + `revalidatePath`).
6. **`.env.example`** + `next build` (validar export `'use server'`: só funções async exportadas — sem `const` exportada na file de action, conforme memória do projeto).

### Checklist de Validação Pós-Implementação
- [ ] `pnpm build` / `next build` sem warnings novos (action só exporta funções async).
- [ ] RLS/trigger: confirmado que a action usa `createServiceClient` (não `createClient`) — senão o trigger bloquearia `authenticated`.
- [ ] Teste: `uid !== SAAS_ADMIN_USER_ID` (lojista e anon) NÃO produz escrita (op capturada vazia).
- [ ] Teste: cada action grava o `{status, fim_periodo, billing_provider}` exato da tabela acima.
- [ ] Teste: `SAAS_ADMIN_USER_ID` ausente → todas as actions lançam (fail-closed).
- [ ] `SAAS_ADMIN_USER_ID` sem `NEXT_PUBLIC_`; ausente em `database.types`/bundle do client (grep).
- [ ] `revalidatePath('/admin/assinantes')` em cada action.
- [ ] Nenhum secret/PII hardcoded; logs de autorização logam só UUID, não email.
