# [006] Service Worker para cache de assets (Turbopack-nativo)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/pwa-vitrine-painel.md

> ⚠️ **RE-ESCOPO DO ARQUITETO (2026-06-19).** O título e o escopo originais prescreviam
> `@ducanh2912/next-pwa`. Essa biblioteca é **incompatível com a stack atual** (Next 16 +
> Turbopack por padrão) e está **descontinuada pelo próprio autor**. Plugar `withPWA` neste
> projeto **quebra `next build`** — exatamente o sintoma que esta issue tenta evitar. A causa
> raiz e a correção estão na seção **Plano Técnico → Diagnóstico**. O objetivo de negócio
> (cachear só assets imutáveis, nunca resposta autenticada) é mantido **integralmente**; só
> muda o **primitivo** (`@serwist/turbopack` no lugar de `@ducanh2912/next-pwa`).

## Objetivo
Registrar um Service Worker que cacheia apenas assets estáticos imutáveis, sem jamais cachear respostas autenticadas (`/painel/*`), HTML dinâmico como verdade, nem preço/catálogo.

## Por que é crítica
O `runtimeCaching` é um vetor de segurança próprio do PWA: cachear uma resposta autenticada ou personalizada pode servir dado de uma sessão a outra (RN-6, §10/§19). A regra "não cachear `/painel/*` nem respostas com cookie/Authorization" é um invariante de isolamento — RED-first sobre a config de cache.

## Escopo
- [ ] Instalar `@serwist/turbopack` + `serwist` + `esbuild` (npm — nunca pnpm, conforme memória de stack)
- [ ] Compor o wrapper em `next.config.ts`: `withSentryConfig(withSerwist(nextConfig), sentryOpts)` — `withSerwist` **dentro** do Sentry (RN-7)
- [ ] `disable: process.env.NODE_ENV === "development"` (não conflitar com `next dev`)
- [ ] SW-source em `src/app/sw.ts` com `runtimeCaching` explícito:
  - cache-first só para imutáveis: `_next/static/*`, fontes, imagens públicas do storage
  - network-first para navegação/HTML
  - **regra `NetworkOnly` que casa `/painel*` ANTES de qualquer regra de cache** — nunca cacheia rota autenticada
  - **não** usar `defaultCache` do Serwist sem auditar (ele inclui regra de páginas RSC — ver Decisão D4)
  - não cachear catálogo/preço como fonte de verdade
- [ ] SW gerado em `/public/sw.js` no build; conferir same-origin (`/sw.js`)
- [ ] Registrar o SW no client (componente `'use client'` no root layout) — Serwist não auto-injeta em App Router
- [ ] Validar que a CSP report-only atual não bloqueia o SW (RN-8; sem mudança de CSP na v1)
- [ ] Adicionar `public/sw.js` e artefatos Serwist ao `.gitignore`
- [ ] Rodar `next build` ao final (constraint de build registrada na memória)

## Fora de escopo
- Botão "Instalar" custom / `beforeinstallprompt` (fora do escopo v1)
- Modo offline funcional (criar pedido offline) e página `/~offline`
- Push notifications (Fase 2)
- Endurecer a CSP (sair de report-only)

## Reuso esperado
- `next.config.ts` existente (Sentry, headers, images.remotePatterns) — compor, não reescrever
- CSP report-only já configurada
- Padrão de teste de função pura com `vitest` (ver `src/lib/utils/*.test.ts`)

## Segurança
- RN-6: SW nunca cacheia `/painel/*` nem respostas autenticadas; HTML network-first; preço sempre revalidado via rede
- RN-7: `withSerwist` dentro de `withSentryConfig`; SW off em dev
- RN-8: garantir que report-only não impede `/sw.js`
- Sem valor monetário persistido. Sem `service_role`.

## Critério de aceite
- [ ] (RED) Teste/asserção falho antes do código sobre a config de `runtimeCaching`: nenhuma regra casa `/painel/*` para cache; existe regra `NetworkOnly` para `/painel*` posicionada **antes** das regras de cache; navegação/HTML é network-first; `_next/static` é cache-first
- [ ] `next build` (Turbopack, sem `--webpack`) gera `/public/sw.js` sem quebrar `withSentryConfig`
- [ ] SW desabilitado em `NODE_ENV=development`
- [ ] Cliente abre a vitrine → SW registra e cacheia `_next/static/*` (verificável em DevTools > Application)
- [ ] Deploy com hash novo → SW busca a versão nova (precache versionado por revision)
- [ ] Teste vermelho escrito e depois verde

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** `@ducanh2912/next-pwa` é um **plugin de webpack** (peer dependency `webpack >=5.9.0`; `withPWA` injeta uma função `webpack` na config). A partir do **Next.js 16, `next build` usa Turbopack por padrão**, e a doc oficial de upgrade afirma textualmente: *"If your project has a custom `webpack` configuration and you run `next build` ... the build will **fail**... it is likely that a **plugin is adding a `webpack` option**."* O `build` script do projeto é `next build` puro (sem `--webpack`). Logo, plugar `withPWA` **quebra o build de produção** — o oposto do critério de aceite. Some-se a isso que o pacote está **descontinuado** (última publicação 2024-09-18, v10.2.9) e o próprio autor recomenda migrar para Serwist. O sucessor Turbopack-nativo é **`@serwist/turbopack@9.5.11`** (publicado 2026-05-03; peer deps `next >=14`, `react >=18`, `esbuild >=0.25`, `typescript >=5`), que compila o SW via **esbuild** — sem tocar em webpack — e é compatível com `next build` Turbopack.

**Por que é complexo:**
- **Contrato de build compartilhado:** `next.config.ts` já é embrulhado por `withSentryConfig`. Inserir outro wrapper exige ordem correta (composição de funções) sob risco de quebrar o upload de source maps do Sentry ou a geração do SW.
- **Efeito cross-cutting de segurança:** o `runtimeCaching` é um invariante de isolamento de tenant (RN-6 / §10). Uma regra mal ordenada cacheia resposta autenticada de `/painel/*` e serve dado de uma sessão a outra. A verdade da config precisa morar em **um** módulo testável.
- **Já foi bloqueada (em potencial):** a issue prescreve a ferramenta que causaria o bloqueio. Sem o re-escopo, a fase GREEN bate na parede do `next build`.
- **Registro manual:** diferente do `next-pwa` (que auto-registrava), Serwist em App Router exige um componente client de registro — passo a mais, fácil de esquecer.

### Mapa de Impacto

```
package.json
  └── + @serwist/turbopack, serwist (deps), esbuild (devDep)

next.config.ts                          [build — AUTORITATIVO da composição]
  ├── withSerwistInit({ swSrc:"src/app/sw.ts", swDest:"public/sw.js", disable: dev })
  │     → lê → src/app/sw.ts            [config do SW — FONTE ÚNICA do runtimeCaching]
  │            └── importa → src/lib/pwa/runtimeCaching.ts   [regras puras — TESTÁVEL no vitest]
  │     → escreve → public/sw.js        [artefato de build — gitignored, same-origin /sw.js]
  └── withSentryConfig(withSerwist(nextConfig), sentryOpts)   [ordem: Serwist DENTRO]

src/app/layout.tsx                      [root layout — Server Component]
  └── renderiza → <RegistrarSW />       [novo Client Component — navigator.serviceWorker.register("/sw.js")]

src/lib/pwa/runtimeCaching.ts           [novo — array de RuntimeCaching: ordem importa]
  └── testado por → src/lib/pwa/runtimeCaching.test.ts   [RED-first]

next.config.ts headers()                [CSP report-only — INALTERADA; validar que /sw.js passa]
```

Camada onde cada invariante é garantida:

```
"SW nunca cacheia /painel/*" garantido em:
  ├── src/lib/pwa/runtimeCaching.ts  — regra NetworkOnly /painel* posicionada ANTES das de cache  [fonte única]
  ├── src/app/sw.ts                  — passa o array intacto ao Serwist (sem defaultCache que reordene)  [composição]
  └── RLS / cookies HttpOnly do painel — defesa real do dado [AUTORITATIVO no servidor — o SW é só UX]
```

> Nota de camada (regra cliente↔servidor): o Service Worker roda **100% no cliente** e é **contornável** (DevTools → unregister). Ele **não é** a linha de defesa do isolamento de tenant — essa continua sendo RLS + cookies HttpOnly + guard server-side do `/painel` (`seguranca.md` §2/§4). O invariante do `runtimeCaching` é defesa-em-profundidade contra **cache poisoning local** (servir do cache uma resposta autenticada a outro usuário do mesmo dispositivo/sessão), não substituto do servidor. Por isso esta issue **não** toca em RLS, migration ou Server Action — e isso é correto, não uma lacuna.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `next.config.ts` | `withSentryConfig(nextConfig, …)`; headers de segurança + CSP report-only; `images.remotePatterns`; `experimental.serverActions` | Embrulhar `nextConfig` com `withSerwist(...)` **antes** de passar ao Sentry. Nada mais muda. |
| `package.json` | deps da stack; `build: "next build"` | + `@serwist/turbopack`, `serwist`, `esbuild`. **NÃO** alterar o script `build` (continua Turbopack). |
| `src/app/layout.tsx` | root layout (Server Component) | Renderizar `<RegistrarSW />` (novo client component) dentro do `<body>`. |
| `vitest.config.ts` | inclui `src/**/*.test.ts`; `environment: node`; alias `server-only` | Sem mudança — o teste de `runtimeCaching.ts` é função pura em node. |
| `.gitignore` | ignora `.next`, `.env*`, etc. | + `/public/sw.js` e companheiros gerados pelo Serwist (não versionar artefato de build). |
| CSP em `next.config.ts` | `script-src 'self' 'unsafe-inline' 'unsafe-eval'`; sem `worker-src` explícito | **Não muda** (report-only não bloqueia; `worker-src` herda de `script-src 'self'`, e `/sw.js` é same-origin). |

Não há setup de PWA pré-existente (`public/` vazio, sem `sw.js`, sem referência a `withPWA`/`serwist` no repo). Issues 004/005 fazem o wiring de `<link rel="manifest">` nos layouts — **independentes** desta; esta issue não cria manifest.

### Decisões de Design

**D1 — Biblioteca do Service Worker: `@ducanh2912/next-pwa` (prescrito) vs `@serwist/turbopack` (escolhido)**
- (a) `@ducanh2912/next-pwa@10.2.9`: **prós** — é o que a issue pediu, API `withPWA` familiar. **contras** — plugin de **webpack** (peer `webpack >=5.9.0`); `next build` no Next 16 usa Turbopack por padrão e **falha** quando um plugin injeta config webpack (doc oficial de upgrade v16); **descontinuado** (sem release desde 2024-09-18); autor recomenda migrar.
- (b) **`@serwist/turbopack@9.5.11` (escolhida)**: **prós** — Turbopack-nativo (compila o SW via **esbuild**, não webpack); compatível com `next build` sem `--webpack`; mantido (publicado 2026-05-03); mesmo runtime caching (Workbox-fork) que o ecossistema `next-pwa` usava; peer deps satisfeitas (`next >=14`, `react >=18`, `esbuild >=0.25`, `typescript >=5`). **contras** — exige componente de **registro manual** do SW (não auto-injeta no App Router); um SW-source em TS (`src/app/sw.ts`) a manter.
- **Escolha:** (b). (a) viola o critério de aceite (`next build` quebraria) — é a causa raiz. (b) entrega o mesmo objetivo de negócio sem tocar em webpack.
- Alternativa descartada — `next build --webpack` para manter (a): reintroduz webpack só para o SW, abre mão de toda performance do Turbopack no build, e mantém uma dep descontinuada. Custo desproporcional vs. trocar o primitivo. Rejeitado.
- Fontes: [Next 16 upgrade — Turbopack default / webpack plugin faz o build falhar](https://nextjs.org/docs/app/guides/upgrading/version-16); [npm @serwist/turbopack](https://www.npmjs.com/package/@serwist/turbopack); [@ducanh2912/next-pwa — descontinuado, recomenda Serwist](https://www.npmjs.com/package/@ducanh2912/next-pwa); [Serwist Turbopack docs](https://serwist.pages.dev/docs/next/turbo).

**D2 — Ordem de composição dos wrappers**
- `withSentryConfig(withSerwist(nextConfig), sentryOpts)` — **Serwist por dentro**.
- **Por quê:** `withSerwist` transforma o objeto de config (adiciona a integração do SW) e retorna um `NextConfig`. O `withSentryConfig` deve enxergar a config **final** (com Serwist já aplicado) para instrumentar/empacotar corretamente e fazer o upload de source maps do bundle completo. Inverter (`withSerwist(withSentryConfig(...))`) faria o Serwist processar a config já mexida pelo Sentry, ordem não suportada/documentada. Mantém o invariante RN-7 do spec literalmente ("withPWA dentro de withSentryConfig").
- Mantém o `temAuthToken`/`sourcemaps.disable` já existentes intactos.

**D3 — Onde mora a verdade do `runtimeCaching`: inline no `sw.ts` vs módulo puro extraído (escolhido)**
- (a) array inline em `src/app/sw.ts`: **contra** — `sw.ts` roda em contexto de Service Worker (`self`, `WorkerGlobalScope`); importá-lo no vitest exige mockar globais de worker. Difícil de testar RED-first.
- (b) **`src/lib/pwa/runtimeCaching.ts` exportando o array (escolhida)**: módulo **puro** que só monta a estrutura de regras (matchers + estratégias). `sw.ts` o importa e entrega ao `new Serwist({ runtimeCaching })`. **prós** — testável em node puro (igual aos utils existentes); a invariante de ordem/exclusão vira asserção unitária; DRY (uma fonte). **contra** — um arquivo a mais.
- **Escolha:** (b). A issue é crítica e o critério de aceite RED é sobre a config de cache — ela **precisa** ser asserção sobre um módulo importável sem subir browser. Responde diretamente à pergunta 2 do briefing: **sim, vitest importando o módulo puro de regras** (sem mock de browser, sem mock do `serwist`).

**D4 — `defaultCache` do Serwist vs `runtimeCaching` explícito (escolhido)**
- `defaultCache` (de `@serwist/turbopack/worker`) traz regras prontas, **incluindo cache de páginas/RSC e de rotas de app** com estratégias de rede. **Risco:** essas regras genéricas podem casar navegação para `/painel/*` ou respostas RSC autenticadas — exatamente o que RN-6 proíbe. Auditar e confiar no default é frágil e some em cada bump da lib.
- **Escolhido:** **não** usar `defaultCache`. Definir um `runtimeCaching` **explícito e mínimo**, com a regra `NetworkOnly` de `/painel*` **na primeira posição** (Serwist avalia as regras em ordem e usa a primeira que casar — `RouteMatchCallback`). Assim o isolamento é legível e testável, não emergente de um default opaco.
- **Por quê:** o critério de aceite exige provar que `/painel/*` nunca vai a cache. Só dá para provar sobre um array que **nós** controlamos.

**D5 — Estratégia por tipo de recurso**
- `_next/static/*` (JS/CSS com hash imutável) → **CacheFirst** (URL versionada por hash; nunca serve versão velha porque o hash muda no deploy).
- Fontes (`font`) e imagens públicas do storage Supabase (`gdlegxatwylhkjcrusyk.supabase.co/storage/v1/object/public/`) → **StaleWhileRevalidate** (revalida em background; imagem trocada aparece na próxima visita).
- Navegação / documento HTML (`request.mode === "navigate"`) → **NetworkFirst** (HTML é dinâmico — catálogo/preço sempre da rede; cache só fallback de resiliência).
- `/painel*` (qualquer método/destino) → **NetworkOnly**, **primeira regra** (nunca cacheia rota autenticada).
- Tudo o mais → sem regra = passthrough de rede (default do browser). Não cachear catálogo/preço como verdade (RN-6 / §10).

**D6 — Registro do SW: componente client no root layout**
- Serwist no App Router **não** injeta `<script>` de registro automaticamente. Criar `src/app/RegistrarSW.tsx` (`'use client'`) com `useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js"); }, [])`, renderizado no root layout. Same-origin `/sw.js` (servido de `public/`) — satisfaz RN-8 e a pergunta 6 (same-origin ✓).

### Cenários

- **Caminho feliz (vitrine):** cliente abre `/loja/[slug]` → `RegistrarSW` registra `/sw.js` → Serwist precacheia `_next/static` (precache manifest versionado) → revisita carrega assets do cache, HTML da rede.
- **Borda — `/painel/*` autenticado:** navegação para `/painel` casa a regra `NetworkOnly` (primeira) → resposta nunca entra em cache; mesmo offline, não há resposta cacheada para servir a outro usuário do dispositivo. Cookies HttpOnly + RLS continuam sendo a defesa real do dado.
- **Borda — resposta com `Set-Cookie`/`Authorization`:** não há regra de cache que case rota dinâmica/API; `/painel*` é `NetworkOnly`; navegação é `NetworkFirst` (Workbox/Serwist por padrão não cacheia respostas `opaque`/erro nas estratégias de cache). Catálogo/preço viajam como HTML/RSC sob navegação → network-first, nunca verdade do cache.
- **Borda — deploy novo (hash diferente):** o precache manifest do Serwist muda o `revision`/URL; o SW novo entra em `waiting`, ativa (`skipWaiting`/`clientsClaim`) e busca os assets novos. Não serve bundle velho.
- **Borda — `NODE_ENV=development`:** `disable: true` no `withSerwist` → `next dev` não gera nem registra SW (sem conflito com Turbopack dev, sem SW "grudado" atrapalhando hot reload).
- **Borda — navegador sem `serviceWorker`:** `RegistrarSW` faz feature-detect (`"serviceWorker" in navigator`) → no-op, app funciona normal.
- **Tratamento de erro:** falha no `register()` não pode derrubar a página — `.catch` que loga no console do cliente (sem PII) e segue. Nenhum erro de SW chega ao usuário como UI quebrada. Build: se o Serwist falhar ao gerar `sw.js`, `next build` falha cedo (visível no CI), antes de deploy.

### Contratos de Dados (se afeta schema ou shape)

**Nenhuma migration. Nenhuma tabela. Nenhuma RLS nova. Nenhum tipo gerado.** Esta issue é 100% infra de build/cliente. O `runtimeCaching` não é "dado" no sentido de schema — é configuração de cache versionada em código e coberta por teste unitário. (Confirma `seguranca.md` §2: sem tabela nova → sem RLS nova.)

### Recálculo no Servidor (se há dinheiro)

**Não se aplica — não há valor monetário nesta issue.** O ponto correlato de `seguranca.md` §10 é respeitado por **omissão de cache**: preço/catálogo nunca são cacheados como verdade (HTML = NetworkFirst; sem regra para APIs de pedido). O valor autoritativo continua sendo recalculado na Server Action `criarPedido` (issue de pedido), inalterada aqui. O SW não pode, por construção, servir um preço velho como autoritativo — ele não cacheia a resposta de criação de pedido nem o RSC de checkout.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/pwa/runtimeCaching.ts` — exporta `const runtimeCaching: RuntimeCaching[]` (tipo de `serwist`). Ordem: `[0]` NetworkOnly `/painel*`; depois CacheFirst `_next/static`; StaleWhileRevalidate fontes; StaleWhileRevalidate imagens storage público; NetworkFirst navegação. Cada regra com `cacheName` distinto.
- `src/lib/pwa/runtimeCaching.test.ts` — **RED-first** (ver Ordem de Implementação). Asserções: índice 0 é `NetworkOnly` e casa `/painel/configuracoes`; nenhuma regra de cache (CacheFirst/SWR) casa `/painel/*`; existe regra NetworkFirst para navegação; existe CacheFirst para `_next/static`. Testa os `matcher` chamando-os com `{ url, request, sameOrigin }` sintéticos e inspeciona a `strategy`/`handler`.
- `src/app/sw.ts` — SW-source: `import { Serwist } from "serwist"`; `import { runtimeCaching } from "@/lib/pwa/runtimeCaching"`; `new Serwist({ precacheEntries: self.__SW_MANIFEST, skipWaiting: true, clientsClaim: true, navigationPreload: true, runtimeCaching }).addEventListeners();`. Tipagem de worker via `/// <reference lib="webworker" />` + `declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: ... }`.
- `src/app/RegistrarSW.tsx` — `'use client'`; `useEffect` que faz `navigator.serviceWorker.register("/sw.js").catch(console.error)` com feature-detect.

**Modificar:**
- `next.config.ts` — importar `withSerwistInit` de `@serwist/turbopack`; criar `const withSerwist = withSerwistInit({ swSrc: "src/app/sw.ts", swDest: "public/sw.js", disable: process.env.NODE_ENV === "development" })`; trocar `export default withSentryConfig(nextConfig, …)` por `export default withSentryConfig(withSerwist(nextConfig), …)`.
- `src/app/layout.tsx` — renderizar `<RegistrarSW />` no `<body>`.
- `package.json` — deps (via `npm install`, não editar à mão se possível).
- `.gitignore` — `+ /public/sw.js` (e demais artefatos gerados pelo Serwist).

**NÃO tocar (com motivo):**
- Bloco `headers()` / CSP em `next.config.ts` — RN-8: report-only não bloqueia `/sw.js` (same-origin, `worker-src` herda `script-src 'self'`). Endurecer CSP está fora de escopo. **Sem mudança de CSP.**
- `sentry.*.config.ts` e os args do `withSentryConfig` (`temAuthToken`, `sourcemaps`, `silent`) — composição não altera o comportamento do Sentry; mexer abriria risco de regressão (issue 061).
- `vitest.config.ts` — o teste é função pura em node; o `include` já cobre `src/**`.
- `build` script (`next build`) — **manter Turbopack**; a escolha de lib (D1) existe justamente para não precisar de `--webpack`.
- Qualquer arquivo de RLS/migration/Server Action — fora do escopo; o invariante desta issue é client-side defesa-em-profundidade, não autorização (ver Nota de camada no Mapa de Impacto).

### Dependências Externas (pacote@versão + doc)

- `@serwist/turbopack@9.5.11` (dep) — wrapper Turbopack-nativo; `withSerwistInit`. Peer: `next >=14`, `react >=18`, `esbuild >=0.25`, `typescript >=5`. Doc: https://serwist.pages.dev/docs/next/turbo
- `serwist@9.5.11` (dep) — runtime do SW (`Serwist`, estratégias, tipo `RuntimeCaching`). Doc: https://serwist.pages.dev/docs/serwist/runtime-caching
- `esbuild@>=0.25` (devDep) — peer do `@serwist/turbopack` para compilar o SW. (Instalar a versão estável corrente que satisfaça `>=0.25 <1.0.0`.)
- **Remover/Não instalar:** `@ducanh2912/next-pwa` — incompatível (ver D1).
- CI: `npm audit --audit-level=high` (seguranca.md §16) deve passar com as deps novas.

### Ordem de Implementação

Issue **crítica** → **fase RED primeiro** (`tdd`), depois GREEN (`executar`).

1. **(RED — `tdd`)** Escrever `src/lib/pwa/runtimeCaching.test.ts` importando `runtimeCaching` de `./runtimeCaching` (módulo **inexistente**). Rodar `npm test` e **confirmar a falha real** (módulo não encontrado / asserções vermelhas). PARA aqui. — *Dep: nada. É o gate da issue crítica.*
2. **(GREEN)** `npm install @serwist/turbopack serwist` + `npm install -D esbuild`. — *Dep: nada; isolado do teste.*
3. **(GREEN)** Criar `src/lib/pwa/runtimeCaching.ts` com o array na ordem de D4/D5 até o teste do passo 1 **passar**. — *Dep: 1 (o teste define o contrato).*
4. **(GREEN)** Criar `src/app/sw.ts` consumindo `runtimeCaching`. — *Dep: 3 (importa o módulo).*
5. **(GREEN)** Editar `next.config.ts`: `withSerwistInit` + composição `withSentryConfig(withSerwist(nextConfig), …)`. — *Dep: 4 (o `swSrc` precisa existir).*
6. **(GREEN)** Criar `src/app/RegistrarSW.tsx` e renderizar no root layout. — *Dep: 5 (sem build não há `/sw.js` para registrar).*
7. **(GREEN)** `.gitignore += /public/sw.js`. — *Dep: 5.*
8. **(VALIDAÇÃO)** `npm run build` (Turbopack). Confirmar geração de `public/sw.js` e ausência de erro de composição Sentry. — *Dep: 5–7. Constraint de memória: rodar `next build` antes de fechar.*

### Checklist de Validação Pós-Implementação
- [ ] `npm test` — teste de `runtimeCaching` verde (era vermelho no passo 1)
- [ ] `npm run build` (Turbopack, **sem `--webpack`**) conclui sem warnings novos e gera `public/sw.js`
- [ ] Composição `withSentryConfig(withSerwist(...))` não quebra o upload de source maps (build com e sem `SENTRY_AUTH_TOKEN`)
- [ ] Asserção RED garante: regra `[0]` é `NetworkOnly` e casa `/painel/*`; nenhuma regra de cache casa `/painel/*`; navegação é NetworkFirst; `_next/static` é CacheFirst
- [ ] `NODE_ENV=development` → SW desabilitado (sem `sw.js` no dev, sem registro)
- [ ] DevTools > Application: SW ativo na vitrine, `_next/static/*` no cache; **nada de `/painel/*` cacheado**
- [ ] CSP report-only não emite violação para `/sw.js` (same-origin)
- [ ] Sem secret no client / sem `service_role` / sem dado pessoal — confirmado (issue é só infra de cache de assets públicos)
- [ ] `public/sw.js` ignorado pelo git (não versionado)

---

## Fase RED (TDD) — concluída

**Teste:** `src/lib/pwa/runtimeCaching.test.ts` (9 casos sobre o invariante RN-6).
**Stub TDD:** `src/lib/pwa/runtimeCaching.ts` exporta `runtimeCachingRules: RuntimeCachingRule[] = []` (array vazio, marcado `STUB TDD`) — só para o teste compilar e falhar nas ASSERÇÕES, não no import. A GREEN preenche o array.

### Output FAIL real (`npx vitest run src/lib/pwa/runtimeCaching.test.ts`)

```
 × runtimeCaching — regra que nunca cacheia > existe pelo menos uma regra com handler NetworkOnly
   → expected 0 to be greater than or equal to 1
 × runtimeCaching — NetworkOnly cobre rota autenticada > a regra NetworkOnly casa /painel/pedidos
   → expected false to be true // Object.is equality
 × runtimeCaching — ordem do isolamento > a regra do índice 0 é NetworkOnly
   → expected undefined to be 'NetworkOnly' // Object.is equality
 × runtimeCaching — ordem do isolamento > a regra do índice 0 casa /painel/pedidos
   → Cannot read properties of undefined (reading 'urlPattern')
 × runtimeCaching — /painel/* nunca chega a uma regra de cache > a PRIMEIRA regra que casa /painel/pedidos é NetworkOnly
   → expected -1 to be greater than or equal to 0
 ✓ runtimeCaching — /painel/* nunca chega a uma regra de cache > nenhuma regra de cache casa /painel/pedidos
 × runtimeCaching — assets imutáveis > existe regra CacheFirst que casa /_next/static/chunks/main.js
   → expected false to be true // Object.is equality
 × runtimeCaching — assets imutáveis > a PRIMEIRA regra que casa o chunk estático NÃO é NetworkOnly
   → expected -1 to be greater than or equal to 0
 × runtimeCaching — navegação HTML é network-first > existe regra NetworkFirst que casa /loja/pizzaria-test
   → expected false to be true // Object.is equality

 Test Files  1 failed (1)
      Tests  8 failed | 1 passed (9)
```

> O 1 passou ("nenhuma regra de cache casa /painel/pedidos") é o teste-guarda do invariante: trivialmente verdadeiro com array vazio e DEVE permanecer verde quando a GREEN inserir a `NetworkOnly` na posição 0. Não é falso-positivo — é a asserção de exclusão que pega cache poisoning de `/painel/*`.

### Contrato para a fase GREEN
Implementar `src/lib/pwa/runtimeCaching.ts` (substituir o stub) com `runtimeCachingRules` nesta ordem (D4/D5):

| idx | handler | casa | NÃO casa |
|---|---|---|---|
| 0 | `NetworkOnly` | `/painel*` (qualquer subpath) | — |
| ≥1 | `CacheFirst` | `/_next/static/*` | `/painel*` |
| ≥1 | `StaleWhileRevalidate` | fontes; imagens públicas do storage Supabase | `/painel*` |
| ≥1 | `NetworkFirst` | navegação HTML (`/loja/[slug]`) | `/painel*` |

Casos que precisam passar (GREEN): índice 0 é `NetworkOnly` e casa `/painel/pedidos`; a primeira regra que casa `/painel/pedidos` é a `NetworkOnly`; nenhuma `CacheFirst`/`StaleWhileRevalidate` casa `/painel/pedidos`; existe `CacheFirst` para `/_next/static/chunks/main.js`; existe `NetworkFirst` para `/loja/pizzaria-test`.
