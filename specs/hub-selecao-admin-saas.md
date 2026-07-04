# Spec: Hub de seleção do dono do SaaS em `/admin`

**Versão:** 0.1.0 | **Atualizado:** 2026-07-03

## Visão Geral

O dono do SaaS (iRango) tem hoje dois destinos distintos: o painel da **sua própria loja** (`/painel`, igual a qualquer lojista) e a **gestão das lojas assinantes** (`/admin/assinantes`). Não existe ponto único de entrada entre os dois — e, pior, o callback OAuth sempre joga qualquer usuário (inclusive o dono do SaaS) direto em `/painel`, sem oferecer o caminho para a área admin.

Esta feature cria o **hub de seleção** em `/admin`: uma página raiz com dois cards de navegação ("Minha loja" → `/painel` e "Clientes" → `/admin/assinantes`) e ajusta o callback de login para que, **quando o usuário autenticado for o dono do SaaS**, ele seja redirecionado ao hub em vez do painel. Qualquer outro usuário (lojista comum) continua indo para `/painel` como hoje.

**Mundo:** painel administrativo (`/admin/*`), auth obrigatória com guard de admin do SaaS (`verificarAdminSaaS()`). Não é vitrine pública nem o painel do lojista.

**Problema que resolve:** dá ao dono do SaaS um ponto de entrada explícito para escolher entre operar a própria loja e gerir os assinantes, e corrige o ponto de decisão do redirect pós-login para reconhecer a identidade do dono no servidor.

## Atores Envolvidos

- **iRango (SaaS / dono):** único ator desta feature. É o único usuário cuja `user.id` bate com `SAAS_ADMIN_USER_ID`; é o único que vê `/admin` e o hub. Escolhe entre "Minha loja" e "Clientes".
- **Lojista:** não age aqui. Não é afetado — seu fluxo de login permanece idêntico (callback → `/painel`), e qualquer tentativa de acessar `/admin` recebe o mesmo tratamento fail-closed das demais rotas admin (redirect para `/painel`).
- **Cliente final:** não participa. Fluxo público inalterado.

## Princípio de segurança: identidade do dono é sempre resolvida no servidor

A identidade de "dono do SaaS" **nunca** é derivada de flag do cliente, cookie legível, query string ou prop. A única prova é a comparação, **no servidor**, de `user.id` (derivado do cookie de sessão HttpOnly, não forjável) contra `process.env.SAAS_ADMIN_USER_ID` (server-only, sem `NEXT_PUBLIC_`). Essa comparação já é encapsulada por `verificarAdminSaaS()` / `obterAdminUserId()` em `src/lib/auth/admin.ts` (RN-13) — reusar, nunca reimplementar.

Os cards do hub são **apenas navegação** (preview de UX): são `<Link>` para `/painel` e `/admin/assinantes`. Renderizá-los não concede autoridade nenhuma — a autoridade real de cada destino é reavaliada no servidor pelo guard de admin (`/admin/*`) e pelo guard de sessão (`/painel`).

---

## Páginas e Rotas

### 1. Hub de seleção do dono do SaaS — `/admin`

**Mundo:** painel admin (auth obrigatória + guard de admin do SaaS).
**Descrição:** nova página raiz de `/admin` (não existe hoje — `src/app/admin/` só tem a subpasta `assinantes/`). Server Component. Prova a identidade do dono via `verificarAdminSaaS()` antes de renderizar; em qualquer falha (não-admin, sessão inválida, env ausente) faz o **mesmo** redirect silencioso para `/painel` usado pela área admin existente. Exibe dois cards de navegação:

- **Card "Minha loja"** — dashboard da loja própria do dono → `/painel`.
- **Card "Clientes"** — gestão das lojas assinantes do SaaS → `/admin/assinantes`.

**Ponto de decisão do guard (débito a resolver nesta feature):** o guard `verificarAdminSaaS()` hoje vive em `src/app/admin/assinantes/layout.tsx`, que envolve apenas a subárvore `assinantes/*` — **não** cobre uma futura `/admin/page.tsx`. Duas opções, escolher no `/plan`:

- **(A) Guard direto na page (recomendado):** `src/app/admin/page.tsx` é um Server Component que chama `verificarAdminSaaS()` no topo dentro de `try/catch` → `redirect("/painel")` no catch. Não move o guard existente, não altera o comportamento de `assinantes/`. Menor raio de mudança.
- **(B) Elevar o guard para `src/app/admin/layout.tsx`:** cobriria `/admin` e `/admin/assinantes` de uma vez, mas exige revisar o comentário/estrutura do `assinantes/layout.tsx` (que hoje deliberadamente **não** envolve `children` em `<main>` — issue 145) para evitar duplicação de guard e aninhamento de layout. Maior raio de mudança.

O spec adota **(A)** como padrão; (B) só se o `/plan` justificar.

**Componentes:**
- `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` (reuso — shadcn/ui em `components/ui/`) — um por opção.
- `Link` (next/link) — envolve cada card; navegação client-side padrão.
- Ícones `lucide-react` (reuso — ex. um ícone de loja para "Minha loja", um de usuários/grupo para "Clientes"). Escolha visual segue `design-claude/` (fonte única do visual — não criar mockup paralelo).
- Tokens de tema via classes utilitárias Tailwind v4 (tokens em `globals.css @theme`; sem `tailwind.config.ts`).

**Behaviors:**
- [ ] Ver os dois cards ("Minha loja", "Clientes") ao acessar `/admin`. Garantido em: Server Component — a página só renderiza após `verificarAdminSaaS()` provar que `user.id === SAAS_ADMIN_USER_ID` no servidor.
- [ ] Ser redirecionado para `/painel` ao acessar `/admin` sem ser o dono do SaaS (lojista comum, sessão inválida ou env ausente). Garantido em: Server Component — `verificarAdminSaaS()` fail-closed → `redirect("/painel")`, mesmo tratamento das demais rotas `/admin/*`; nenhum dado admin é renderizado.
- [ ] Clicar em "Minha loja" e navegar para `/painel`. Garantido em: cliente (navegação/UX); a autoridade do destino é o guard de sessão do painel.
- [ ] Clicar em "Clientes" e navegar para `/admin/assinantes`. Garantido em: cliente (navegação/UX); a autoridade do destino é `verificarAdminSaaS()` no `assinantes/layout.tsx`.

---

### 2. Callback OAuth — ponto de decisão do redirect pós-login — `src/app/(auth)/auth/callback/route.ts` (modificação)

**Mundo:** auth (Route Handler público que troca `code` por sessão).
**Descrição:** hoje a última linha do handler é `return NextResponse.redirect(\`${origin}${next ?? "/painel"}\`)` — **sempre** `/painel` quando não há `next` explícito. A mudança: **depois** de trocar o `code` por sessão (portanto com `data.user` já disponível e autoritativo) e **antes** do redirect final, decidir o destino padrão:

- Se `next` explícito e sanitizado está presente → respeitá-lo (comportamento inalterado; `next` sempre tem prioridade).
- Senão, se `data.user.id === process.env.SAAS_ADMIN_USER_ID` → destino padrão `/admin` (o hub).
- Senão → destino padrão `/painel` (comportamento atual do lojista comum).

O anti-open-redirect existente (`sanitizarNext`: aceita só path interno, rejeita `//` e não-`/`) permanece intacto e continua aplicado apenas ao `next` explícito. A comparação de identidade do dono roda **no servidor** (Route Handler), lendo `SAAS_ADMIN_USER_ID` server-only — reusar `obterAdminUserId()` de `src/lib/auth/admin.ts`, tratando ausência da env como "não é admin" (fail-safe: cai em `/painel`, nunca quebra o login).

**Reuso, não recriação:** a decisão consome `obterAdminUserId()` (já existe). Não introduzir nova leitura de env nem novo helper de identidade. `verificarAdminSaaS()` faz um `getUser()` adicional que aqui é redundante (o handler já tem `data.user` do `exchangeCodeForSession`); preferir comparar `data.user.id` contra `obterAdminUserId()` diretamente, encapsulado num pequeno helper server-only reutilizável (ex. `ehAdminSaaS(userId: string): boolean` em `admin.ts`) para não duplicar a leitura da env — decidir no `/plan`.

**Behaviors:**
- [ ] Fazer login como dono do SaaS (sem `next` explícito) e ser levado a `/admin`. Garantido em: Route Handler (servidor) — `data.user.id` do `exchangeCodeForSession` comparado com `SAAS_ADMIN_USER_ID` server-only.
- [ ] Fazer login como lojista comum (sem `next` explícito) e continuar indo para `/painel`. Garantido em: Route Handler (servidor) — id não bate → destino padrão inalterado.
- [ ] Login com `next` explícito (ex. deep link) respeitado para qualquer usuário, após `sanitizarNext`. Garantido em: Route Handler (servidor) — `next` tem prioridade e passa pelo anti-open-redirect existente.
- [ ] `SAAS_ADMIN_USER_ID` ausente/vazia não quebra o login de ninguém → cai em `/painel`. Garantido em: Route Handler (servidor) — leitura tolerante a ausência (fail-safe para `/painel`), sem lançar no fluxo de login.

---

## Modelos de Dados

**Nenhuma tabela, coluna ou migration nova.** A feature não toca o banco: a identidade do dono é uma variável de ambiente (`SAAS_ADMIN_USER_ID`), não um registro. Portanto **não há RLS nova** — a autoridade das rotas `/admin/*` é o guard `verificarAdminSaaS()` no servidor (não RLS), coerente com o padrão admin já documentado (`seguranca.md` §7).

Nenhuma leitura de dados de negócio é feita pelo hub: `/admin/page.tsx` renderiza dois links estáticos; não consulta `lojas`, `pedidos` nem qualquer tabela.

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| Identidade de "dono do SaaS" resolvida só no servidor (`user.id === SAAS_ADMIN_USER_ID`), nunca por flag/prop do cliente. | Server (`verificarAdminSaaS()` na page; `obterAdminUserId()` no callback). RN-13. |
| `/admin` é acessível apenas ao dono do SaaS; qualquer outro → redirect `/painel` (fail-closed), sem renderizar dado admin. | Server Component — `verificarAdminSaaS()` no topo de `/admin/page.tsx` (opção A) ou em `/admin/layout.tsx` (opção B). |
| Pós-login, dono do SaaS vai a `/admin`; lojista comum vai a `/painel`. | Route Handler (callback) — comparação de `data.user.id` com `obterAdminUserId()`. |
| `next` explícito sempre tem prioridade sobre o destino padrão, para qualquer usuário. | Route Handler — `next` avaliado antes da decisão dono/lojista, após `sanitizarNext`. |
| Anti-open-redirect preservado (só path interno; rejeita `//` e não-`/`). | Route Handler — `sanitizarNext` inalterado. |
| Env de admin ausente não quebra o login. | Route Handler — leitura tolerante (fail-safe para `/painel`); contrasta com `verificarAdminSaaS()` (fail-closed) usado nos guards de `/admin/*`. |
| Cards do hub são navegação pura (preview de UX), não concedem autoridade. | Cliente (UX); autoridade real reavaliada no servidor em cada destino. |

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** nenhum PII, chave Pix, cupom ou valor monetário é lido, exibido ou escrito por esta feature. O único dado sensível envolvido é a **identidade do dono** (`SAAS_ADMIN_USER_ID`), que permanece server-only (sem `NEXT_PUBLIC_`) e nunca é enviada ao cliente — apenas comparada no servidor.
- **Valor monetário?** Não. Nenhum recálculo no servidor é introduzido — não há checkout, cupom nem frete nesta feature.
- **Tabela nova?** Não → nenhuma política RLS nova. A defesa das rotas `/admin/*` é o guard `verificarAdminSaaS()` (fail-closed), não RLS.
- **API externa com key?** Não.
- **Fronteira cliente ↔ servidor:** a decisão de destino do redirect e o gate de acesso a `/admin` são 100% servidor. O cliente só recebe um redirect já decidido e dois `<Link>` estáticos; não há valor autoritativo delegado ao cliente.
- **Open redirect:** preservar `sanitizarNext` exatamente como está; os destinos padrão novos (`/admin`, `/painel`) são literais internos fixos, não derivados de input do usuário.
- **Fail-closed vs. fail-safe (atenção no `/plan`):** os guards de rota admin são **fail-closed** (erro/env ausente → nega acesso). O callback de login é **fail-safe** (erro/env ausente → cai em `/painel`, não bloqueia o login). Distinção intencional: um problema de configuração não deve trancar todos os lojistas para fora do painel — mas também nunca deve conceder acesso admin (isso continua sendo do guard fail-closed em `/admin/*`).
- **Não regressão do isolamento admin:** esta feature não adiciona Server Actions nem eleva a `service_role`; as suítes `enforcement-escopo-admin.test.ts` / `isolamento-admin.test.ts` permanecem válidas sem alteração.

## Fora de Escopo (v1)

- **Múltiplos admins / papéis de equipe do SaaS** — a identidade continua sendo um único `SAAS_ADMIN_USER_ID`. Modelo de RBAC multi-admin é fase futura (`modelo-negocio.md` §Roadmap).
- **Renomear `/admin/assinantes` para `/admin/clientes`** — decisão explícita do usuário: manter a rota `/admin/assinantes`. O card apenas rotula "Clientes" na UI e aponta para `/admin/assinantes`.
- **Métricas/resumo no hub** (nº de assinantes, receita, alertas) — o hub v1 é só seleção de dois caminhos, sem leitura de dados de negócio.
- **Impersonation de sessão** ("logar como o lojista") — inalterado; o modelo admin continua `service_role` escopado (`paridade-hub-admin-painel.md`).
- **Mudança no fluxo de login do lojista comum** além do ponto de decisão do redirect — nenhuma regressão de comportamento para quem não é o dono do SaaS.
- **Log de auditoria de acesso admin** — débito pré-existente (`registrarAcessoAdmin` no-op); não construído aqui.

---

**Próximo passo:** `/break` passando este spec (`specs/hub-selecao-admin-saas.md`) para gerar as issues acionáveis, na ordem: (1) helper de identidade reutilizável em `admin.ts` (se opção de helper for adotada) → (2) ajuste do ponto de decisão no callback OAuth → (3) nova `/admin/page.tsx` com guard + dois cards (visual guiado por `design-claude/`).
