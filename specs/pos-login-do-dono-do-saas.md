# Spec: Pós-login do dono do SaaS — hub de escolha entre "minha loja" e "clientes"

**Versão:** 0.2.0 | **Atualizado:** 2026-09-09

## Resolução do sintoma original (2026-09-09)

O sintoma relatado pelo usuário ("faço login com Google e caio direto no painel da loja, não no hub de escolha") **era config, não código**. `SAAS_ADMIN_USER_ID` em `.env.local` estava com um UUID placeholder (`00000000-0000-4000-8000-000000000001`), que não correspondia a nenhum usuário real do projeto. `ehAdminSaaS` é fail-safe por design (RN-5): env divergente degrada em silêncio para "lojista comum", indistinguível de "o hub não existe".

Diagnóstico confirmado com um script de leitura pura (`auth.admin.listUsers`, sem expor o valor da env — só o veredito `CONFERE`/`DIVERGE`): **DIVERGE**. Corrigido `.env.local` com o `user.id` real da conta Google do dono (`contato.tarciso@gmail.com`, UID `fdfd003f-04f3-40e5-b693-6b9501de66af`, confirmado no Supabase Studio). Usuário confirmou em 2026-09-09 que o direcionamento pós-login passou a funcionar (`/admin` no lugar de `/painel`).

**Pendente, não bloqueante:** o mesmo ajuste em produção/preview (Vercel), fora do escopo desta sessão — o usuário decide quando aplicar.

O restante deste spec (páginas 2 e 3 — retorno ao hub a partir de `/painel` e de `/admin/assinantes`) continua válido como lacuna real de navegação, mas **deixa de ser urgente**: com o gate zero resolvido, o dono já chega ao hub corretamente; falta só a porta de volta depois de escolher um lado. Ver `plan/loop-pos-login-do-dono-do-saas.md` para o status do loop de execução.

## Correção da premissa (leia antes de planejar)

A descrição pedida é:

> "Do SaaS, que também é lojista, faz login com Google e é direcionado automaticamente para painel da sua loja, não para painel onde pode escolher ver sua loja ou ver o painel de clientes."

**Mapeamento do comportamento real (2026-09-09, branch `fix/160-props-action-obrigatorias`): o comportamento pedido JÁ ESTÁ IMPLEMENTADO.** As issues 148 (bifurcação do callback) e 149 (hub `/admin`) o entregaram. Evidência:

| Caminho | Arquivo | Comportamento hoje |
|---|---|---|
| Login com Google (OAuth) | `src/app/(auth)/auth/callback/route.ts:46` | `const destinoPadrao = data.user && ehAdminSaaS(data.user.id) ? "/admin" : "/painel"` — dono do SaaS cai no hub, lojista comum no painel |
| Login com email/senha | `src/lib/actions/auth.ts:165` | `const destino = ehAdminSaaS(data.user.id) ? "/admin" : "/painel"` — mesmo critério, decidido na Server Action; o cliente só faz `router.push(resultado.destino)` |
| Hub de escolha | `src/app/admin/page.tsx` | Server Component com dois cards: "Minha loja" → `/painel` e "Clientes" → `/admin/assinantes`; guard `verificarAdminSaaS()` fail-closed no próprio componente, falha → `redirect("/painel")` |
| Identidade admin | `src/lib/auth/admin.ts` | `ehAdminSaaS(userId)` compara `user.id` (de sessão verificada) contra `SAAS_ADMIN_USER_ID` — env **server-only, sem `NEXT_PUBLIC_`**; variante fail-**safe** (env ausente → `false`, login nunca quebra) |
| `middleware.ts` | `src/middleware.ts` | só `updateSession` — não decide destino, não participa de authz. **Não muda nesta feature.** |
| Lojista comum | — | `ehAdminSaaS` → `false` → `/painel` direto. Nunca vê tela de escolha; se digitar `/admin`, o guard redireciona para `/painel`. Preservado integralmente. |

Portanto **esta feature não é "construir o hub"** — é fechar as quatro lacunas que sobraram e que fazem o hub parecer inexistente na prática. A principal: **depois de escolher "Minha loja", não existe caminho de volta ao hub.** O dono entra em `/painel`, e a única forma de voltar a `/admin` é digitar a URL — o que reproduz exatamente a sensação descrita no pedido ("fui direcionado para o painel da minha loja e não tenho onde escolher").

**Se o usuário está vendo `/painel` direto após o login com Google**, além do gap de retorno há uma hipótese de configuração a verificar antes de codar: `SAAS_ADMIN_USER_ID` ausente ou divergente do `user.id` real da conta Google no ambiente em uso (`.env.local` / Vercel). `ehAdminSaaS` é fail-safe — env ausente degrada silenciosamente para "não é admin" e manda para `/painel`, sem erro visível. **Passo zero, antes de qualquer issue:** confirmar o valor da env contra o `user.id` da conta (ver Regras de Negócio, RN-5).

## Visão Geral

Fecha o ciclo do hub de escolha do dono do SaaS: garante que ele **chegue** ao hub após o login (já existe), **volte** ao hub a partir de qualquer uma das duas áreas (não existe), e que o hub se comporte previsivelmente nos casos de borda (admin sem loja própria, admin com mais de uma loja, escolha lembrada ou não).

**Mundo:** auth (callback e login) + painel do lojista (`/painel/*`) + hub admin (`/admin/*`). Nada toca a vitrine pública.

**Relação com `specs/paridade-hub-admin-painel.md`:** aquele spec cobre a **paridade de UI dentro de `/admin/assinantes/[lojaId]`** — o admin operando a loja de um terceiro com o mesmo shell do lojista. Ele já entregou o shell parametrizado (`NavPainel` com `contexto.basePath`) e a faixa de contexto com "Voltar para assinantes". **Não se sobrepõe a este spec:** lá o assunto é *gerenciar a loja de outro*; aqui é *navegar entre os dois chapéus do próprio dono do SaaS*. O ponto de contato é um só: o `contexto` de `NavPainel`, que este spec estende com um item de retorno ao hub. Nada do que aquele spec definiu é redefinido aqui.

## Atores Envolvidos

- **iRango (dono do SaaS):** único ator novo. Tem dois chapéus — lojista da própria loja (`/painel`) e operador do SaaS (`/admin/assinantes`). É a única identidade que vê o hub.
- **Lojista comum:** **não age nesta feature e não pode ser afetado por ela.** Nenhum item de nav novo, nenhuma tela de escolha, nenhum passo extra no login. Regressão aqui é falha de aceite.
- **Cliente final:** não age e não é afetado. Nenhuma rota pública muda.

---

## Páginas e Rotas

### 1. Hub de seleção — `/admin`

**Mundo:** painel admin (auth obrigatória + guard de admin do SaaS).
**Descrição:** página **já existente** (`src/app/admin/page.tsx`), com dois cards. Esta feature altera apenas o tratamento dos casos de borda e o texto de apoio; a estrutura, o guard e o layout permanecem.

**Componentes:**
- `Card` / `CardHeader` / `CardTitle` / `CardDescription` (reuso — shadcn `components/ui/card`, já em uso na page).
- `Link` do Next + ícones `Store` / `Users` (`lucide-react`, já em uso).
- Nenhum componente novo.

**Behaviors:**
- [ ] Ver o hub após login (Google ou email/senha), sem passo extra. **Garantido em: Server Action / Route Handler** — `ehAdminSaaS(user.id)` sobre `user.id` de sessão verificada, em `auth.ts` e `callback/route.ts`. Já implementado; cobre com teste de regressão.
- [ ] Ser bloqueado no hub se não for o dono do SaaS. **Garantido em: Server Component** — `verificarAdminSaaS()` fail-closed dentro do `try`, `redirect("/painel")` no `catch` (fora do try, para o `NEXT_REDIRECT` propagar — `seguranca.md` §7). Já implementado.
- [ ] Escolher "Minha loja" → `/painel`. Garantido em: cliente (navegação); a autoridade de acesso é o guard de `/painel`.
- [ ] Escolher "Clientes" → `/admin/assinantes`. Garantido em: cliente (navegação); a autoridade é `verificarAdminSaaS()` no `admin/assinantes/layout.tsx`.
- [ ] Ver, no card "Minha loja", o nome da própria loja quando ela existe, ou o rótulo "Sua loja ainda não foi criada" quando não existe. **Garantido em: Server Component** — leitura da própria loja pelo `dono_id` da sessão. Nunca aceita `lojaId` da URL ou do cliente.

---

### 2. Painel do lojista — retorno ao hub — `/painel/*`

**Mundo:** painel (auth obrigatória).
**Descrição:** o shell do painel ganha um ponto de retorno ao hub, **visível apenas para o dono do SaaS**. Sem ele, escolher "Minha loja" é uma porta de mão única e o hub deixa de existir na prática. Para o lojista comum, o shell fica byte-a-byte como está hoje.

**Componentes:**
- `SidebarPainel` / `TopbarPainel` (reuso — `src/components/painel/NavPainel.tsx`). O tipo `ContextoNav` já existe (`basePath?`, `titulo?`) e já é parametrizado pelo hub admin (issue da paridade). Estender com **um campo opcional** para o link de retorno (ex.: `voltarPara?: { href: string; rotulo: string }`), default `undefined` = comportamento atual do lojista, zero mudança visual para ele.
- `PainelLayout` (modificar — `src/app/(painel)/painel/layout.tsx`): já resolve `user` autoritativo via `supabase.auth.getUser()` no ramo `"ok"`. Decide ali, **no servidor**, se passa o retorno no `contexto`.
- Nenhum componente novo; nenhuma edição em `components/ui/`.

**Behaviors:**
- [ ] Dono do SaaS vê, no shell do painel, um item de retorno ao hub (ex.: "Painel do iRango" → `/admin`). **Garantido em: Server Component (renderização) + guard de `/admin` (autoridade).** O booleano que decide renderizar o item é calculado por `ehAdminSaaS(user.id)` **no `layout.tsx`**, sobre o `user.id` de `getUser()` — nunca por flag vinda do cliente, nunca por env `NEXT_PUBLIC_`. Renderizar o link é UX; quem autoriza o acesso é `verificarAdminSaaS()` dentro de `/admin`, que roda de novo a cada request.
- [ ] Lojista comum **não** vê esse item e não percebe diferença alguma no painel. **Garantido em: Server Component** — `contexto.voltarPara` fica `undefined`, o item não é renderizado (ausência de markup, nunca `hidden`/CSS — `architecture.md` §6, mesma regra do entitlement por feature).
- [ ] Lojista comum que force `/admin` na URL cai em `/painel`. **Garantido em: Server Component** — guard já existente. Cobrir com teste.

---

### 3. Lista de assinantes — retorno ao hub — `/admin/assinantes`

**Mundo:** painel admin (auth + guard de admin).
**Descrição:** hoje `/admin/assinantes` só tem link para frente (`/admin/assinantes/nova`) e cada loja tem "Voltar para assinantes" — mas nada volta para `/admin`. O outro braço do hub também é mão única.

**Componentes:**
- `Link` + ícone `ArrowLeft` (reuso — mesmo padrão do "Voltar para assinantes" já existente em `admin/assinantes/[lojaId]/layout.tsx:55`). Nenhum componente novo.

**Behaviors:**
- [ ] Voltar de `/admin/assinantes` para o hub `/admin`. Garantido em: cliente (navegação); toda a subárvore continua sob `verificarAdminSaaS()` no `layout.tsx`.
- [ ] Não alterar a faixa de contexto de `/admin/assinantes/[lojaId]` (que já volta para a lista, um nível acima — comportamento correto, definido em `specs/paridade-hub-admin-painel.md`). Garantido em: escopo desta feature (não-mudança).

---

## Modelos de Dados

**Nenhuma tabela nova, nenhuma coluna nova, nenhuma migration, nenhuma política RLS nova.**

Tabelas lidas (todas já em `schema.md`, todas já com RLS):

- `lojas` — leitura da própria loja do dono, sob RLS `lojas_leitura_propria` (`auth.uid() = dono_id`), via a query existente `buscarLojaDoDono(client)` (`src/lib/supabase/queries/lojas.ts:62`). O card do hub **não** eleva para `service_role`: a loja é a do próprio usuário logado, a RLS basta e é a defesa correta.
- `auth.users` — só indiretamente, via `supabase.auth.getUser()`.

**Invariante de banco que esta feature depende (e não pode quebrar):** `CREATE UNIQUE INDEX lojas_dono_unico ON lojas(dono_id)` (`supabase/migrations/20260614003500_unique_loja_por_dono.sql`, `schema.md:415`). É ela que torna `buscarLojaDoDono` — hoje um `.select("*").maybeSingle()` sem `.eq("dono_id")`, apoiado em RLS para filtrar — determinístico. Ver RN-3.

## Regras de Negócio

| # | Regra | Camada que garante |
|---|---|---|
| RN-1 | "Esta conta é o dono do SaaS" é decidido **só no servidor**, comparando `user.id` de sessão verificada contra `SAAS_ADMIN_USER_ID` (server-only, sem `NEXT_PUBLIC_`). Nenhum booleano de admin vindo do cliente, de cookie, de header ou de payload jamais decide acesso. | **Server Action / Route Handler / Server Component** — `ehAdminSaaS()` (decisão de destino e de UI) e `verificarAdminSaaS()` (autorização de área). O cliente pode, no máximo, receber um booleano já decidido para **renderizar um link**; forjá-lo não dá acesso a nada, porque `/admin` reprova a identidade a cada request. |
| RN-2 | **Admin sem loja própria.** O card "Minha loja" nunca leva a um beco: `/painel` já auto-cura o usuário órfão — `decidirAcessoBase` devolve `"onboarding"` e o layout chama `garantirLojaDoDono` (RPC idempotente sob `service_role`) e recarrega. Comportamento **mantido**; a mudança é só de transparência: o card do hub rotula "Sua loja ainda não foi criada" em vez de mostrar um nome vazio, e o provisionamento deixa de ser surpresa. | **Server Component (`PainelLayout`) + RPC `garantir_loja_do_dono` sob `service_role`.** `user.id`/`user.email` vêm de `getUser()`, nunca do browser (já é assim). |
| RN-3 | **Admin com mais de uma loja: impossível hoje, e o spec não a introduz.** `lojas(dono_id)` é UNIQUE. Se a unicidade fosse removida, `buscarLojaDoDono` (`.maybeSingle()`, sem `.eq("dono_id")`) passaria a lançar `PGRST116`, o `catch` do layout mandaria para `/login?erro=sessao` e o dono ficaria **trancado fora do próprio painel** — falha dura, não degradação. Ação desta feature: **documentar a dependência** (comentário na query apontando o índice) e **travar com teste** que a query é determinística. Suporte real a multi-loja é fora de escopo e exige migration + escolha de loja no hub. | **CHECK/índice no banco** (`lojas_dono_unico`) + teste de regressão. |
| RN-4 | **A escolha não é lembrada — o hub sempre pergunta.** Decisão explícita para a v1. Um cookie/`localStorage` de "última área" seria dado de transporte controlado pelo cliente; usá-lo para *pular* uma tela é inofensivo, mas cria a tentação de usá-lo para *decidir área*, que é exatamente a classe de bug do achado #3B do pentest (`seguranca.md` §4, header de rota forjável). Com o retorno ao hub disponível dos dois lados (páginas 2 e 3), o custo de sempre perguntar é um clique. Reavaliar só com pedido explícito. | **Ausência de estado** — nada a garantir; a regra é não construir. |
| RN-5 | **`SAAS_ADMIN_USER_ID` ausente ou errado degrada silenciosamente para "lojista comum".** É intencional (fail-safe: config faltando nunca derruba o login de ninguém), mas é indistinguível, para o usuário, de "o hub não existe". Passo zero de diagnóstico antes de codar; e o `console.error` já existente em `obterAdminUserId` é a única pista — nunca expor a env nem o motivo na UI. | **Servidor** (`ehAdminSaaS` fail-safe vs. `verificarAdminSaaS` fail-closed, `seguranca.md` §7). |
| RN-6 | `next` explícito na URL do callback continua tendo prioridade sobre o destino por identidade, já sanitizado contra open-redirect (`sanitizarNext`: só path interno, rejeita `//`). **Não mexer.** | **Route Handler** — `callback/route.ts`. |
| RN-7 | `middleware.ts` **não** participa desta decisão. Continua só refrescando sessão. Nenhum redirect por identidade, nenhum header de rota — reintrodução disso é regressão do achado #3B. | **Estrutura** — travado por `middleware.test.ts`. |
| RN-8 | Zero impacto no lojista comum: mesmo destino de login, mesmo shell, mesmos itens de nav. | **Server Component** (default `undefined` no `contexto`) + teste. |

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** a identidade do dono do SaaS (`SAAS_ADMIN_USER_ID`) — **server-only, jamais com `NEXT_PUBLIC_`, jamais no bundle do cliente**. O nome da própria loja exibido no card do hub é dado do próprio usuário, lido sob RLS. **Nenhuma PII de cliente final e nenhuma loja de terceiro é lida nesta feature** — o hub não lista assinantes, só linka para a lista que já tem seu próprio guard.
- **Valor monetário:** **nenhum.** Esta feature não toca preço, frete, cupom, total ou billing. Não há recálculo de valor a fazer; o `seguranca.md` §10 não é acionado.
- **Tabela nova:** não. **Nenhuma política RLS nova.** A leitura da própria loja usa a RLS existente `lojas_leitura_propria`; a área admin continua protegida por `verificarAdminSaaS()` + `service_role` escopado (RLS não é a defesa lá — `seguranca.md` §7).
- **API externa com key:** nenhuma.
- **Superfície de authz alterada:** o único ponto delicado é o booleano "é admin" que cruza a fronteira RSC para renderizar o link de retorno no `NavPainel` (Client Component). **Ele controla markup, não acesso.** Um cliente que force esse booleano vê um link; clicá-lo cai em `verificarAdminSaaS()`, que redireciona para `/painel`. A revisão deve confirmar que esse booleano não é lido por nenhuma outra decisão. O item **não é escondido por CSS**: quando falso, o markup não existe (mesmo padrão do entitlement por feature, `architecture.md` §6).
- **Anti open-redirect:** `sanitizarNext` permanece intocado; qualquer issue que altere o callback deve manter os testes de `route.test.ts` verdes.
- **TDD red-first:** a issue que mexer no **critério de identidade** (destino por `ehAdminSaaS`, guard de `/admin`, booleano de nav) é **crítica: SIM** — autorização. Testes vermelhos exigidos antes do código: (a) admin → `/admin` nos dois caminhos de login; (b) não-admin → `/painel` nos dois caminhos; (c) não-admin em `/admin` → redirect; (d) env ausente → todo mundo vira não-admin, ninguém quebra; (e) `next` explícito vence o destino por identidade; (f) lojista comum não recebe o item de retorno no `contexto`. As issues puramente de link/copy (página 3) são não-críticas.
- **Verificação sem browser:** o ambiente não tem Playwright nem MCP de browser (`tasks/176`). **Nenhum critério de aceite pode depender de teste e2e.** O aceite automatizado é vitest (funções puras, Route Handler, Server Actions, decisão do layout); o aceite visual é **manual pelo usuário**, com um roteiro escrito na issue: entrar com Google → esperar `/admin`; clicar "Minha loja" → `/painel` com o item de retorno; clicar o retorno → `/admin`; clicar "Clientes" → `/admin/assinantes` com o voltar para `/admin`. Contra-prova com a segunda conta: um lojista comum ("Lanches base") não vê nada disso.

## Fora de Escopo (v1)

- **Suporte real a múltiplas lojas por dono** (escolher entre N lojas no hub, item de troca de loja no nav). Exige remover `lojas_dono_unico` + migration + revisar `buscarLojaDoDono`, `contarLojasDoDono` e a RN-01 do cadastro. Não é pedido; a UNIQUE atual é a regra de negócio vigente.
- **Lembrar a última área escolhida** (cookie/`localStorage`/coluna de preferência) — RN-4.
- **Papéis/permissões granulares** (mais de um admin, admin somente-leitura, equipe do SaaS). Hoje admin é uma env com um único `user.id`. Modelo de papéis é fase futura e exigiria tabela + RLS nova.
- **Impersonation de sessão** ("logar como o lojista"). O modelo continua `service_role` escopado — `specs/paridade-hub-admin-painel.md`, Fora de Escopo.
- **Qualquer mudança em `middleware.ts`** — RN-7.
- **Redesenho do hub** (métricas do SaaS, atalhos, contagem de assinantes no card). O hub continua sendo duas portas.
- **Mudanças na vitrine pública** — nenhuma.

---

**Status (2026-09-09):** passo (0) resolvido — era a causa do sintoma relatado, corrigido em `.env.local`, confirmado pelo usuário. **Passos (1)–(4) viram backlog não-urgente**, sem data definida — o usuário sinalizou explicitamente que o link de volta ao hub "não é urgente". Retomar com `quebrar` passando este spec quando houver prioridade, na mesma ordem já sugerida: (1) testes de regressão do destino por identidade, cobertura (não crítica — comportamento já implementado, ver RN-1) → (2) `ContextoNav.voltarPara` + decisão no `PainelLayout`, crítica → (3) link de retorno em `/admin/assinantes` e copy do card "Minha loja", não-crítica → (4) comentário + teste de determinismo em `buscarLojaDoDono` (RN-3), não-crítica.
