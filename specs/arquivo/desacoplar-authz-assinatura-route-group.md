# Spec: Desacoplar Authz de Assinatura do Header `x-pathname` (route group `(bloqueavel)`)

**Versão:** 0.1.0 | **Atualizado:** 2026-07-08

> Origem: handoff de pentest `plan/pentest-handoff-2026-07-08.md` §3B, arquitetado em `plan/pentest-3B-route-group-plan.md` (decisão técnica, mapa de arquivos, ordem). Este spec formaliza aquele plano no formato de `specs/`. **É higiene arquitetural (débito latente), NÃO uma vuln ativa** — não explorável em `next@16.2.9` (fora da faixa CVE-2025-29927). Complexidade MÉDIA.

## Visão Geral

O gate de assinatura do painel (paywall "assinatura vencida bloqueia o acesso") hoje depende de uma string de rota que **chega pelo transporte**: `src/lib/supabase/middleware.ts` grava `x-pathname` no header do request, e `src/app/(painel)/painel/layout.tsx` o lê via `headers()` e o repassa como `rota` para `decidirAcessoPainel(user, loja, rota, agora)` em `src/lib/utils/acessoPainel.ts`. Essa `rota` alimenta o passo 4 da decisão (gate de assinatura) através da lista anti-loop `ROTAS_EXCECAO_ASSINATURA`.

O problema: a **autorização** (decidir se um lojista com assinatura vencida pode ver uma tela) está acoplada a um dado que o cliente controlaria se o middleware fosse pulado (CVE futuro de bypass de middleware, `matcher` mal configurado, refactor acidental). Nesse cenário, um lojista inadimplente poderia forjar `x-pathname: /painel/configuracoes/assinatura` e furar o paywall. Hoje a barreira que impede isso é o próprio middleware — exatamente a peça que a classe de bug CVE-2025-29927 ataca.

A solução (Opção 2 do plano) elimina a dependência: as telas isentas do gate (`/painel/assinatura-bloqueada`, `/painel/configuracoes/assinatura`) saem da subárvore de rotas que aplica o gate, movendo-se para **fora** de um novo route group `(bloqueavel)`. Com isso a lista `ROTAS_EXCECAO_ASSINATURA` deixa de ser necessária, a `rota` sai de `decidirAcessoPainel`, e o header `x-pathname` some. A invariante "assinatura vencida bloqueia" passa a ser garantida por **posição na árvore de rotas** (estrutura de filesystem), não por comparação de string vinda do transporte — imune a header forjado.

Vive 100% no **mundo painel (auth obrigatório)**. Não toca vitrine pública, não toca valor monetário de pedido/frete/cupom. O eixo de segurança aqui é **autorização (authz) server-side**, não recálculo de preço.

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|--------------------|
| **iRango (SaaS)** | Dono da arquitetura de authz. Reestrutura a árvore de rotas do painel e as funções puras de decisão. Nenhuma mudança visível ao usuário final. |
| **Lojista** | Sujeito do gate. Com assinatura válida acessa tudo; com assinatura vencida só alcança as duas telas isentas (bloqueio + página de assinatura). Comportamento observável **idêntico** ao de hoje. |
| **Cliente (comprador)** | Não participa — não tem login e não acessa `/painel/*` (`architecture.md` §4). |

## Páginas e Rotas

> **Regra de ouro deste spec:** nenhuma URL muda. Route group `(bloqueavel)` usa parênteses — o segmento **não** aparece na URL. Todas as rotas `/painel/...` continuam idênticas; nenhum `<Link>`, `redirect()` ou `href` é editado (`NavPainel.tsx` intocado).

### Layout raiz do painel — `src/app/(painel)/painel/layout.tsx` (alteração)
**Mundo:** painel (auth obrigatório)
**Descrição:** Continua sendo o guard de sessão/identidade e o dono do chrome (Sidebar + Topbar). Deixa de ler `x-pathname`/`headers()` e deixa de decidir assinatura. Passa a aplicar apenas `decidirAcessoBase(user, loja)` e a auto-cura de loja órfã. Envolve `children` no chrome. **O gate de assinatura sai daqui.**

**Componentes:** (reuso — nada novo de UI)
- `SidebarPainel`, `TopbarPainel` (`@/components/painel/NavPainel`) — inalterados.
- `createClient` (`@/lib/supabase/server`), `buscarLojaDoDono`/`garantirLojaDoDono` (`@/lib/supabase/queries/lojas`), `createServiceClient`, `VERSAO_TERMOS` — reuso do I/O já existente.
- `decidirAcessoBase` (função pura nova em `acessoPainel.ts`).

**Behaviors:**
- [ ] Resolver sessão autoritativa e loja do dono. Garantido em: **Server Component + `supabase.auth.getUser()`** (server-side; nunca do browser).
- [ ] Redirecionar anônimo → `/login`; email não confirmado → `/confirmar-email`. Garantido em: **Server Component + `decidirAcessoBase`** (função pura). **crítico (authz) — TDD red-first quando quebrado em issue.**
- [ ] Auto-curar user órfão (sessão+email OK, sem loja) via `garantirLojaDoDono` sob `service_role`, fail-closed → `/login?erro=sessao`. Garantido em: **Server Component + service_role**. `user.id`/`user.email` autoritativos do `getUser`.
- [ ] Renderizar chrome (Sidebar/Topbar) ao redor de `children`. Garantido em: servidor (render). Cosmético.

---

### Layout do grupo bloqueável — `src/app/(painel)/painel/(bloqueavel)/layout.tsx` (NOVO)
**Mundo:** painel (auth obrigatório)
**Descrição:** Layout aninhado que envolve **apenas** as telas sujeitas ao paywall. Aplica exclusivamente o gate de assinatura: refaz o I/O mínimo (`createClient` → `getUser` → `buscarLojaDoDono`, fail-closed), roda `decidirAssinatura(loja, agora)` e, se bloqueado, `redirect("/painel/assinatura-bloqueada")`. Retorna `children` **cru** — o chrome vem do layout pai. Envolve `buscarLojaDoDono` em `React.cache()` para deduplicar o I/O dentro do mesmo request (o pai também busca a loja).

**Componentes:** (reuso — sem UI)
- `createClient` (`@/lib/supabase/server`), `buscarLojaDoDono` (`@/lib/supabase/queries/lojas`) — reuso.
- `decidirAssinatura` (função pura nova em `acessoPainel.ts`).
- `React.cache` — dedup do I/O de loja no request (não é componente visual).

**Behaviors:**
- [ ] Recarregar sessão/loja fail-closed (try/catch → `/login?erro=sessao`). Garantido em: **Server Component (layout aninhado)**. Detalhe do erro só em `console.error`, nunca ao cliente (`seguranca.md` §14).
- [ ] Bloquear acesso quando a assinatura não libera → `redirect("/painel/assinatura-bloqueada")`. Garantido em: **Server Component + `decidirAssinatura` (função pura, sem `rota`, sem `headers()`)**. **crítico (authz) — TDD red-first quando quebrado em issue.**
- [ ] Liberar `children` cru quando a assinatura libera. Garantido em: servidor (render).

**Páginas SOB `(bloqueavel)/` (movidas — gate aplicado por posição):**
`painel/(bloqueavel)/page.tsx` (dashboard), `produtos/` (+`produtos/opcionais/`), `pedidos/` (+`pedidos/[id]/`), `cupons/`, e `configuracoes/{pagamentos,entregas,horarios,perfil,tema}/`.

---

### Telas isentas — FORA de `(bloqueavel)` (posição = isenção)
**Mundo:** painel (auth obrigatório, mas sem gate de assinatura)
**Descrição:** Estas duas telas ficam **paradas** onde estão hoje (filhas diretas de `painel/`, não do grupo bloqueável). É a garantia estrutural do anti-loop: uma loja bloqueada precisa conseguir abrir a tela de bloqueio e a tela de assinatura, senão vira deadlock (o gate redirecionaria para uma rota que o próprio gate bloqueia).

- `painel/assinatura-bloqueada/` — tela de "sua assinatura venceu".
- `painel/configuracoes/assinatura/` — tela onde o lojista regulariza a assinatura.

Sem colisão de URL: são leaves distintas e **não existe** `painel/configuracoes/page.tsx`, então mover as sub-rotas de `configuracoes/` para dentro do grupo (exceto `assinatura/`) não gera conflito de rota.

**Behaviors:**
- [ ] Loja com assinatura vencida abre `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura` sem ser redirecionada. Garantido em: **estrutura da árvore de rotas** (essas telas não são cobertas pelo `(bloqueavel)/layout.tsx`) — não mais por comparação de string. **crítico (anti-loop) — teste estrutural (filesystem) trava a regressão.**

---

### Middleware de sessão — `src/lib/supabase/middleware.ts` (alteração)
**Mundo:** infra (roda antes de todo request via `src/middleware.ts`)
**Descrição:** Remove a linha `request.headers.set("x-pathname", ...)` e corrige o comentário falso (`:5-7`) que a descreve. `updateSession` fica **só** como refresh de cookie/sessão (`getUser`). Não decide autorização — restrição dura preservada.

**Behaviors:**
- [ ] Refresh de sessão/cookie a cada request. Garantido em: middleware (só `getUser`, sem redirect de authz).
- [ ] NÃO propagar mais `x-pathname`. Garantido em: ausência do código (grep zero) + `cve-guard` verde.

---

## Modelos de Dados

**Nenhuma mudança de schema. Nenhuma migration. Nenhuma tabela nova. Nenhuma política RLS nova.** (Registrado explicitamente: `schema.md` inalterado.)

Esta feature é um **refator da árvore de rotas + split de função pura**. Não cria, altera ou lê coluna alguma. A regra de negócio de assinatura (`assinatura_status`, `assinatura_fim_periodo`) já existe em `LojaCompleta` e continua sendo lida exatamente como hoje, via `buscarLojaDoDono` (protegida por RLS `auth.uid() = dono_id`). O que muda é **onde** a decisão sobre esses dados é aplicada na árvore, não os dados.

### Contratos de função (split de `decidirAcessoPainel` em `acessoPainel.ts`)

```ts
// Sessão / email / existência de loja. Sem rota, sem assinatura.
export function decidirAcessoBase(
  user: User | null,
  loja: LojaCompleta | null,
): "ok" | "login" | "confirmar-email" | "onboarding";
//   1. user null → "login"   2. !email_confirmed_at → "confirmar-email"
//   3. loja null → "onboarding"   4. "ok"

// Só assinatura, fail-closed. loja NON-NULL. Sem rota, sem headers.
export function decidirAssinatura(
  loja: LojaCompleta,
  agora: Date,
): "ok" | "assinatura-bloqueada";
//   assinaturaLibera(loja, agora) ? "ok" : "assinatura-bloqueada"

// DELETAR: `decidirAcessoPainel`, o parâmetro `rota`, e `ROTAS_EXCECAO_ASSINATURA`.
```

- `assinaturaLibera` (helper interno fail-closed já existente) é **reusado** por `decidirAssinatura` — não recriar a regra de carência. Ele já delega a `assinaturaPermiteAcesso` de `@/lib/utils/assinatura.ts` (`assinatura.ts` **não** é tocado).
- Ambas as funções permanecem **puras**: sem I/O, sem `Date.now()` (o `agora` é injetado), **sem `headers()`** (restrição dura #3).

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-01 | A decisão de acesso ao painel é **100% server-side**. O cliente nunca a influencia. | **Server Components de layout + funções puras** (`decidirAcessoBase`/`decidirAssinatura`). Sessão via `getUser` autoritativo. |
| RN-02 | O gate de assinatura **não depende mais de `rota`** nem de qualquer dado de transporte. É aplicado por **posição na árvore**: só o que está sob `(bloqueavel)/` é gated. | **Estrutura de filesystem (route group)** — `(bloqueavel)/layout.tsx` só envolve as telas gated. |
| RN-03 | Loja com assinatura vencida **sempre** consegue abrir `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura` (anti-loop, sem deadlock). | **Estrutura** — essas duas telas ficam FORA de `(bloqueavel)/`, então nenhum gate de assinatura as cobre. Antes era garantido por `ROTAS_EXCECAO_ASSINATURA` (string). |
| RN-04 | Regra de assinatura (status + carência) inalterada; postura **fail-closed** mantida (dúvida → bloqueia). | **`assinaturaLibera` + `assinaturaPermiteAcesso`** (reuso; `assinatura.ts` intocado). |
| RN-05 | Authz **nunca** migra para o middleware. `updateSession` fica só como refresh de sessão. | **Middleware sem redirect de authz** — travado por `src/middleware.cve-guard.test.ts` (`NextResponse.redirect` e `x-middleware-subrequest` proibidos). |
| RN-06 | Funções de decisão são **puras**: nunca recebem `headers()` nem input de transporte. | **Contrato de tipo** (`decidirAssinatura(loja, agora)`) + teste unitário + critério de aceite (grep). |
| RN-07 | Toda URL `/painel/...` permanece idêntica. | **Route group `()`** não afeta URL; nenhum `<Link>`/`href`/`redirect` de rota editado. |

### Fronteira cliente ↔ servidor (autorização, não dinheiro)

Esta feature **não tem valor monetário** — não há preview de UX de frete/desconto/total, não há recálculo de preço. O dado sensível é **a decisão de autorização** (quem pode ver qual tela do painel com assinatura vencida).

- **Autoritativo (servidor):** 100% da decisão. Sessão (`getUser` server-side), existência de loja (`buscarLojaDoDono` sob RLS), estado de assinatura (`LojaCompleta` do banco), e a aplicação do gate (redirect no Server Component de layout). **Não existe preview de cliente aqui** — não há nenhuma cópia da decisão no browser que pudesse divergir do servidor.
- **O que era o problema:** a `rota` que alimentava o gate vinha de um header de request (`x-pathname`) — um vetor controlável pelo cliente se o middleware fosse pulado. Este spec o elimina. A verdade da autorização deixa de ter qualquer entrada de transporte.

Alinhado a `seguranca.md` §10 ("o cliente nunca define o resultado autoritativo") e §3 ("authz mora no Server Component, não no middleware").

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** nenhum novo. Sessão do lojista (cookies HttpOnly, geridos pelo `@supabase/ssr`) e estado de assinatura da própria loja (já lido hoje sob RLS). Nenhuma PII de comprador, chave Pix, cupom ou valor monetário toca esta feature.
- **Valor monetário?** Não. Sem recálculo de preço — a seção existe para registrar a **ausência**: o único "valor" é a decisão de authz, que já é 100% server-side e passa a não ter mais entrada de transporte.
- **Tabela nova → RLS?** Não há tabela nova; nenhuma política RLS a criar ou alterar. A defesa de tenant do painel continua sendo RLS `auth.uid() = dono_id` em `lojas` (`seguranca.md` §2), inalterada.
- **API externa com key?** Não.
- **Restrição dura — authz nunca no middleware:** `updateSession` permanece só refresh de sessão. Proibido introduzir `NextResponse.redirect(...)` ou depender de `x-middleware-subrequest` — travado por `src/middleware.cve-guard.test.ts`. Essa é a mitigação estrutural da classe CVE-2025-29927: mesmo com o middleware pulado, os Server Components de layout não renderizam sem sessão autoritativa e o gate de assinatura é posicional.
- **Postura fail-closed:** todo I/O de sessão/loja nos layouts fica em try/catch → `redirect("/login?erro=sessao")`; detalhe só em `console.error`, nunca ao cliente (`seguranca.md` §14).
- **Regressão do anti-loop:** a garantia de que as telas isentas **não** caiam sob `(bloqueavel)/` é testável e é o coração da correção — um teste estrutural (filesystem, padrão `cve-guard`) trava isso.

### Issues críticas (exigem TDD red-first — `crítica: SIM`)

Toda mudança neste spec toca **autorização**, logo é implementação crítica. Quando quebrada em issues (`/break`), cada peça de authz exige teste vermelho ANTES da implementação:

- **Split `decidirAcessoBase`/`decidirAssinatura`** (`acessoPainel.ts`): reescrever `acessoPainel.test.ts` para as duas funções puras; deletar os blocos "anti-loop" (~271-315) e "contrato-constante" (~320-327) que testavam `rota`/`ROTAS_EXCECAO_ASSINATURA`. **TDD red-first.**
- **Teste estrutural anti-loop (filesystem)**: novo teste (padrão `cve-guard`) que **falha** se `assinatura-bloqueada/page.tsx` ou `configuracoes/assinatura/page.tsx` estiverem sob `(bloqueavel)/`. É a trava de regressão do RN-03. **red-first.**
- **`(bloqueavel)/layout.tsx` + edição do `painel/layout.tsx`**: o gate de assinatura e o gate de sessão. Cobrir o caminho bloqueado (redirect) e o liberado. **red-first.**

## Critérios de Aceite

- [ ] `grep -rn "x-pathname" src/` → **zero** ocorrências.
- [ ] `grep -rn "ROTAS_EXCECAO_ASSINATURA" src/` → **zero** ocorrências.
- [ ] `npx vitest run src/lib/utils/acessoPainel.test.ts` → verde (duas funções puras + teste estrutural anti-loop).
- [ ] `npx vitest run src/middleware.cve-guard.test.ts` → verde (só removemos header; nenhum `NextResponse.redirect`/`x-middleware-subrequest` introduzido).
- [ ] `npx next build` → sem colisão de rota e sem warning novo (route group não altera URL).
- [ ] `decidirAssinatura` não recebe nenhum input de transporte (assinatura `(loja, agora)`; sem `rota`, sem `headers()`).
- [ ] Teste estrutural (filesystem) travando que `assinatura-bloqueada/` e `configuracoes/assinatura/` **NÃO** estão sob `(bloqueavel)/`.
- [ ] Comportamento observável do lojista idêntico ao de hoje: assinatura vencida bloqueia todo o resto e libera as duas telas isentas.

## Fora do Escopo (v1 desta correção)

- **Qualquer mudança de schema, migration ou RLS** — é refator de árvore + função pura. Explicitamente nada de banco.
- **Mudança de URL, de `<Link>`, de navegação ou de UI** — nenhuma tela muda visualmente; nenhuma rota muda de endereço.
- **Mover authz para o middleware** — proibido (RN-05, `cve-guard`). O middleware continua só refresh de sessão.
- **Opção 1 (pathname nativo em Server Component)** — não existe em `next@16`; rejeitada no plano.
- **Opção 3 (só corrigir o comentário falso do middleware)** — remendo; a `rota` de transporte continuaria alimentando authz; rejeitada.
- **Reescrever `assinatura.ts` / `assinaturaPermiteAcesso`** — a regra de carência é reusada como está.
- **Upgrade/pin de versão do `next`** — a mitigação de CVE é arquitetural (posicional), não de versão; o pin já é guardado pelo `cve-guard`.
- **Tocar `src/middleware.ts`, `manifest.webmanifest/route.ts` ou `NavPainel.tsx`** — fora do escopo por decisão do plano.
